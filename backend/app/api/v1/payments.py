from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.finance import (
    Invoice, CustomerPayment, CustomerPaymentAllocation, JournalEntry, JournalLine, Account,
)
from app.schemas.billing import CustomerPaymentIn, VerifyPaymentIn
from app.api.v1.deps import require_permission, is_super_admin
from app.services.numbering import next_reference
from app.services.audit import log as audit_log
from decimal import Decimal

router = APIRouter(prefix="/payments", tags=["payments"])

CASH_ACCOUNT = "1000"  # Cash/Bank


def refresh_invoice_status(invoice: Invoice) -> None:
    if invoice.paid_amount >= invoice.total:
        invoice.status = "fully_paid"
    elif invoice.paid_amount > 0:
        invoice.status = "partially_paid"
    else:
        invoice.status = "unpaid"


def payment_to_dict(p: CustomerPayment) -> dict:
    return {
        "id": p.id, "internal_ref": p.internal_ref,
        "organization_id": p.organization_id, "payment_date": p.payment_date,
        "method": p.method, "transaction_ref": p.transaction_ref,
        "amount": str(p.amount), "status": p.status,
        "allocations": [
            {"invoice_id": a.invoice_id, "amount": str(a.amount)} for a in p.allocations
        ],
    }


@router.get("/customer")
def list_payments(status: str | None = None, organization_id: int | None = None,
                  db: Session = Depends(get_db),
                  user=Depends(require_permission("payment.record"))):
    q = select(CustomerPayment).order_by(CustomerPayment.id.desc())
    if status:
        q = q.where(CustomerPayment.status == status)
    if organization_id:
        q = q.where(CustomerPayment.organization_id == organization_id)
    return [payment_to_dict(p) for p in db.execute(q).scalars().all()]


@router.post("/customer", status_code=201)
def record_payment(payload: CustomerPaymentIn, db: Session = Depends(get_db),
                   user=Depends(require_permission("payment.record"))):
    if payload.amount <= 0:
        raise HTTPException(422, "Amount must be positive")

    dup = db.execute(select(CustomerPayment).where(
        CustomerPayment.transaction_ref == payload.transaction_ref
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "A payment with this transaction reference already exists")

    allocated = sum(a.amount for a in payload.allocations)
    if allocated > payload.amount:
        raise HTTPException(422, "Allocations exceed payment amount")

    payment = CustomerPayment(
        internal_ref=next_reference(db, "CP"),
        organization_id=payload.organization_id,
        payment_date=payload.payment_date, method=payload.method,
        transaction_ref=payload.transaction_ref, amount=payload.amount,
        description=payload.description, status="pending_verification",
        recorded_by_id=user.id,
        allocations=[
            CustomerPaymentAllocation(invoice_id=a.invoice_id, amount=a.amount)
            for a in payload.allocations
        ],
    )
    db.add(payment)
    db.flush()
    audit_log(db, user.id, "create", "payments", payment.internal_ref,
              new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(payment)
    return payment_to_dict(payment)


@router.post("/customer/{payment_id}/verify")
def verify_payment(payment_id: int, payload: VerifyPaymentIn, db: Session = Depends(get_db),
                   user=Depends(require_permission("payment.verify"))):
    payment = db.get(CustomerPayment, payment_id)
    if payment is None:
        raise HTTPException(404, "Payment not found")
    if payment.recorded_by_id == user.id and not is_super_admin(user):
        raise HTTPException(403, "You cannot verify a payment you recorded")
    if payment.status != "pending_verification":
        raise HTTPException(409, f"Payment status '{payment.status}' cannot be verified")

    if not payload.approve:
        payment.status = "rejected"
        db.flush()
        audit_log(db, user.id, "reject", "payments", payment.internal_ref, reason=payload.reason)
        db.commit()
        return payment_to_dict(payment)

    # Apply allocations: update invoices + post journal (Dr Cash / Cr AR)
    allocated_total = Decimal("0")
    for alloc in payment.allocations:
        invoice = db.get(Invoice, alloc.invoice_id)
        if invoice is None:
            raise HTTPException(404, f"Invoice {alloc.invoice_id} not found")
        if invoice.organization_id != payment.organization_id:
            raise HTTPException(422, f"Invoice {invoice.internal_ref} belongs to another customer")
        outstanding = invoice.total - invoice.paid_amount
        if alloc.amount > outstanding:
            raise HTTPException(409, f"Allocation of {alloc.amount} exceeds outstanding "
                                      f"{outstanding} on {invoice.internal_ref}")
        invoice.paid_amount += alloc.amount
        refresh_invoice_status(invoice)
        allocated_total += alloc.amount

    cash = db.execute(select(Account).where(Account.code == CASH_ACCOUNT)).scalar_one_or_none()
    ar = db.execute(select(Account).where(Account.code == "1100")).scalar_one_or_none()
    if cash is None or ar is None:
        raise HTTPException(500, "Chart of accounts incomplete")
    db.add(JournalEntry(
        entry_no=f"JE-{payment.internal_ref}",
        entry_date=payment.payment_date,
        narration=f"Customer payment {payment.internal_ref}",
        source="payment", source_ref=payment.internal_ref,
        lines=[
            JournalLine(account_id=cash.id, debit=allocated_total, credit=Decimal("0")),
            JournalLine(account_id=ar.id, debit=Decimal("0"), credit=allocated_total),
        ],
    ))

    payment.status = "verified"
    payment.verified_by_id = user.id
    from datetime import datetime, timezone
    payment.verified_at = datetime.now(timezone.utc)
    db.flush()
    audit_log(db, user.id, "verify", "payments", payment.internal_ref, reason=payload.reason)
    db.commit()
    db.refresh(payment)
    return payment_to_dict(payment)


@router.post("/customer/{payment_id}/reverse")
def reverse_payment(payment_id: int, payload: VerifyPaymentIn, db: Session = Depends(get_db),
                    user=Depends(require_permission("payment.reverse"))):
    payment = db.get(CustomerPayment, payment_id)
    if payment is None:
        raise HTTPException(404, "Payment not found")
    if payment.status != "verified":
        raise HTTPException(409, "Only verified payments can be reversed")

    for alloc in payment.allocations:
        invoice = db.get(Invoice, alloc.invoice_id)
        invoice.paid_amount -= alloc.amount
        refresh_invoice_status(invoice)

    payment.status = "reversed"
    payment.reversal_reason = payload.reason
    db.flush()
    audit_log(db, user.id, "reverse", "payments", payment.internal_ref, reason=payload.reason)
    db.commit()
    return payment_to_dict(payment)