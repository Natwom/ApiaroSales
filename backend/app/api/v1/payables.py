from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import Supplier
from app.models.procurement import PurchaseOrder
from app.models.payables import SupplierPayment
from app.api.v1.deps import require_permission
from app.services.ledger import post_entry
from app.services.refs import next_ref
from app.services.audit import log as audit_log

router = APIRouter(prefix="/payables", tags=["payables"])
METHODS = {"mpesa_manual", "bank_transfer", "cash", "cheque", "other"}


class SupplierPaymentIn(BaseModel):
    po_id: int
    amount: Decimal
    payment_date: date
    method: str = "bank_transfer"
    reference: Optional[str] = None
    notes: Optional[str] = None


def _paid_map(db: Session) -> dict[int, Decimal]:
    rows = db.execute(
        select(SupplierPayment.po_id, func.coalesce(func.sum(SupplierPayment.amount), 0))
        .group_by(SupplierPayment.po_id)
    ).all()
    return {pid: Decimal(str(v)) for pid, v in rows}


def _received_value(po: PurchaseOrder) -> Decimal:
    return sum((Decimal(i.qty_received) * i.unit_cost for i in po.items), Decimal("0"))


@router.get("")
def payables(db: Session = Depends(get_db),
             user=Depends(require_permission("payment.record"))):
    suppliers = {s.id: s.name for s in db.execute(select(Supplier)).scalars().all()}
    paid = _paid_map(db)
    pos = db.execute(
        select(PurchaseOrder).where(PurchaseOrder.status != "cancelled").order_by(PurchaseOrder.id.desc())
    ).scalars().all()
    out = []
    for p in pos:
        received = _received_value(p)
        pd = paid.get(p.id, Decimal("0"))
        out.append({
            "id": p.id, "internal_ref": p.internal_ref, "supplier_id": p.supplier_id,
            "supplier": suppliers.get(p.supplier_id, f"#{p.supplier_id}"),
            "order_date": p.order_date, "expected_date": p.expected_date, "status": p.status,
            "total": str(p.total), "received_value": str(received), "paid": str(pd),
            "outstanding": str(received - pd),
        })
    return out


@router.get("/payments")
def list_payments(db: Session = Depends(get_db),
                  user=Depends(require_permission("payment.record"))):
    suppliers = {s.id: s.name for s in db.execute(select(Supplier)).scalars().all()}
    pos = {p.id: p.internal_ref for p in db.execute(select(PurchaseOrder)).scalars().all()}
    rows = db.execute(select(SupplierPayment).order_by(SupplierPayment.id.desc())).scalars().all()
    return [{
        "id": r.id, "internal_ref": r.internal_ref, "supplier_id": r.supplier_id,
        "supplier": suppliers.get(r.supplier_id), "po_id": r.po_id, "po_ref": pos.get(r.po_id),
        "payment_date": r.payment_date, "method": r.method, "reference": r.reference,
        "amount": str(r.amount), "notes": r.notes,
    } for r in rows]


@router.post("/payments", status_code=201)
def record_payment(payload: SupplierPaymentIn, db: Session = Depends(get_db),
                   user=Depends(require_permission("payment.record"))):
    if payload.amount <= 0:
        raise HTTPException(422, "Amount must be positive")
    if payload.method not in METHODS:
        raise HTTPException(422, "Unknown payment method")
    po = db.get(PurchaseOrder, payload.po_id)
    if po is None or po.status == "cancelled":
        raise HTTPException(404, "Purchase order not found")
    outstanding = _received_value(po) - _paid_map(db).get(po.id, Decimal("0"))
    if payload.amount > outstanding:
        raise HTTPException(409, f"Only {outstanding} is owed on {po.internal_ref} (goods received minus payments)")

    sp = SupplierPayment(
        internal_ref=next_ref(db, "SPAY", "API-SP"), supplier_id=po.supplier_id, po_id=po.id,
        payment_date=payload.payment_date, method=payload.method, reference=payload.reference,
        amount=payload.amount, notes=payload.notes, created_by_id=user.id,
    )
    db.add(sp)
    db.flush()
    post_entry(db, entry_date=payload.payment_date, narration=f"Supplier payment {sp.internal_ref} for {po.internal_ref}",
               source="supplier_payment", source_ref=sp.internal_ref,
               lines=[("2000", payload.amount, Decimal("0")), ("1000", Decimal("0"), payload.amount)])
    audit_log(db, user.id, "create", "payables", sp.internal_ref, new=payload.model_dump(mode="json"))
    db.commit()
    return {"id": sp.id, "internal_ref": sp.internal_ref}