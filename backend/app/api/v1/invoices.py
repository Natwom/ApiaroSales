from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import CustomerOrder, CustomerOrderItem
from app.models.finance import Invoice, InvoiceItem, JournalEntry, JournalLine, Account
from app.schemas.billing import InvoiceIn
from app.api.v1.deps import require_permission
from app.services.numbering import next_reference
from app.services.audit import log as audit_log
from decimal import Decimal, ROUND_HALF_UP

router = APIRouter(prefix="/invoices", tags=["invoices"])

# Default chart-of-accounts codes used by the posting engine
AR_ACCOUNT = "1100"       # Accounts Receivable
REVENUE_ACCOUNT = "4000"  # Sales Revenue
TAX_ACCOUNT = "2200"      # Tax Payable


def post_invoice_journal(db: Session, invoice: Invoice, user_id: int | None) -> None:
    def acct(code: str) -> Account:
        a = db.execute(select(Account).where(Account.code == code)).scalar_one_or_none()
        if a is None:
            raise HTTPException(500, f"Chart of accounts missing account {code}")
        return a

    entry = JournalEntry(
        entry_no=next_reference(db, "INV").replace("INV", "JE"),
        entry_date=invoice.invoice_date,
        narration=f"Invoice {invoice.internal_ref}",
        source="invoice", source_ref=invoice.internal_ref,
        lines=[
            JournalLine(account_id=acct(AR_ACCOUNT).id, debit=invoice.total, credit=Decimal("0")),
            JournalLine(account_id=acct(REVENUE_ACCOUNT).id, debit=Decimal("0"), credit=invoice.subtotal),
        ],
    )
    if invoice.tax_amount > 0:
        entry.lines.append(
            JournalLine(account_id=acct(TAX_ACCOUNT).id, debit=Decimal("0"), credit=invoice.tax_amount)
        )
    db_total_d = sum(l.debit for l in entry.lines)
    db_total_c = sum(l.credit for l in entry.lines)
    if db_total_d != db_total_c:
        raise HTTPException(500, "Journal does not balance — refusing to post")
    db.add(entry)


def invoice_to_dict(inv: Invoice) -> dict:
    return {
        "id": inv.id, "internal_ref": inv.internal_ref,
        "organization_id": inv.organization_id, "lpo_id": inv.lpo_id,
        "order_id": inv.order_id, "invoice_date": inv.invoice_date,
        "due_date": inv.due_date, "subtotal": str(inv.subtotal),
        "tax_amount": str(inv.tax_amount), "total": str(inv.total),
        "paid_amount": str(inv.paid_amount), "status": inv.status,
        "items": [
            {"product_id": i.product_id, "description": i.description,
             "quantity": i.quantity, "unit_price": str(i.unit_price),
             "line_total": str(i.line_total)} for i in inv.items
        ],
    }


@router.get("")
def list_invoices(status: str | None = None, organization_id: int | None = None,
                  db: Session = Depends(get_db),
                  user=Depends(require_permission("invoice.create"))):
    q = select(Invoice).order_by(Invoice.id.desc())
    if status:
        q = q.where(Invoice.status == status)
    if organization_id:
        q = q.where(Invoice.organization_id == organization_id)
    return [invoice_to_dict(i) for i in db.execute(q).scalars().all()]


@router.post("", status_code=201)
def create_invoice(payload: InvoiceIn, db: Session = Depends(get_db),
                   user=Depends(require_permission("invoice.create"))):
    if payload.order_id:
        order = db.get(CustomerOrder, payload.order_id)
        if order is None:
            raise HTTPException(404, "Order not found")
        # Do not invoice unsupplied goods: invoiced qty per product <= collected qty
        collected = {i.product_id: i.qty_collected for i in order.items}
        for item in payload.items:
            if item.quantity > collected.get(item.product_id, 0):
                raise HTTPException(409, f"Cannot invoice {item.quantity} of product "
                                          f"{item.product_id}: only {collected.get(item.product_id, 0)} collected")

    subtotal = Decimal("0")
    items: list[InvoiceItem] = []
    for i in payload.items:
        line_total = (Decimal(str(i.quantity)) * i.unit_price).quantize(Decimal("0.01"), ROUND_HALF_UP)
        subtotal += line_total
        items.append(InvoiceItem(
            product_id=i.product_id, description=i.description,
            quantity=i.quantity, unit_price=i.unit_price, line_total=line_total,
        ))

    tax = (subtotal * Decimal(payload.tax_rate) / Decimal("100")).quantize(Decimal("0.01"))
    invoice = Invoice(
        internal_ref=next_reference(db, "INV"),
        organization_id=payload.organization_id,
        lpo_id=payload.lpo_id, order_id=payload.order_id,
        invoice_date=payload.invoice_date, due_date=payload.due_date,
        subtotal=subtotal, tax_amount=tax, total=subtotal + tax,
        status="unpaid", created_by_id=user.id, items=items,
    )
    db.add(invoice)
    db.flush()
    post_invoice_journal(db, invoice, user.id)
    audit_log(db, user.id, "create", "invoices", invoice.internal_ref,
              new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(invoice)
    return invoice_to_dict(invoice)