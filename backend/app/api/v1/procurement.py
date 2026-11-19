from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import Supplier, Product, Warehouse
from app.models.procurement import PurchaseOrder, PurchaseOrderItem
from app.api.v1.deps import require_permission, is_super_admin
from app.services import stock as stock_service
from app.services.ledger import post_entry
from app.services.refs import next_ref
from app.services.audit import log as audit_log

router = APIRouter(prefix="/procurement", tags=["procurement"])


class POItemIn(BaseModel):
    product_id: int
    quantity: int
    unit_cost: Decimal


class POIn(BaseModel):
    supplier_id: int
    order_date: date
    expected_date: Optional[date] = None
    notes: Optional[str] = None
    items: list[POItemIn]


class POApproveIn(BaseModel):
    approve: bool = True
    reason: Optional[str] = None


class ReceiveLineIn(BaseModel):
    item_id: int
    quantity: int


class POReceiveIn(BaseModel):
    warehouse_id: int
    reference: Optional[str] = None      # supplier's delivery note / invoice number
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None
    items: list[ReceiveLineIn]


def po_to_dict(po: PurchaseOrder) -> dict:
    return {
        "id": po.id, "internal_ref": po.internal_ref, "supplier_id": po.supplier_id,
        "order_date": po.order_date, "expected_date": po.expected_date,
        "status": po.status, "total": str(po.total), "notes": po.notes,
        "created_by_id": po.created_by_id, "approved_by_id": po.approved_by_id,
        "items": [{
            "id": i.id, "product_id": i.product_id, "quantity": i.quantity,
            "unit_cost": str(i.unit_cost), "qty_received": i.qty_received,
            "outstanding_qty": i.quantity - i.qty_received,
        } for i in po.items],
    }


@router.get("")
def list_pos(status: str | None = None, supplier_id: int | None = None,
             db: Session = Depends(get_db),
             user=Depends(require_permission("inventory.receive"))):
    q = select(PurchaseOrder).order_by(PurchaseOrder.id.desc())
    if status:
        q = q.where(PurchaseOrder.status == status)
    if supplier_id:
        q = q.where(PurchaseOrder.supplier_id == supplier_id)
    return [po_to_dict(p) for p in db.execute(q).scalars().all()]


@router.post("", status_code=201)
def create_po(payload: POIn, db: Session = Depends(get_db),
              user=Depends(require_permission("inventory.receive"))):
    if db.get(Supplier, payload.supplier_id) is None:
        raise HTTPException(422, "Supplier not found")
    if not payload.items:
        raise HTTPException(422, "A purchase order needs at least one item")
    ids = [i.product_id for i in payload.items]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "A product can appear only once on a purchase order")

    total = Decimal("0")
    items: list[PurchaseOrderItem] = []
    for i in payload.items:
        if i.quantity <= 0:
            raise HTTPException(422, "Quantity must be positive")
        if i.unit_cost < 0:
            raise HTTPException(422, "Unit cost cannot be negative")
        if db.get(Product, i.product_id) is None:
            raise HTTPException(422, f"Product {i.product_id} not found")
        total += Decimal(i.quantity) * i.unit_cost
        items.append(PurchaseOrderItem(product_id=i.product_id, quantity=i.quantity, unit_cost=i.unit_cost))

    po = PurchaseOrder(
        internal_ref=next_ref(db, "PORD", "API-PO"),
        supplier_id=payload.supplier_id, order_date=payload.order_date,
        expected_date=payload.expected_date, notes=payload.notes,
        total=total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
        status="pending_approval", created_by_id=user.id, items=items,
    )
    db.add(po)
    db.flush()
    audit_log(db, user.id, "create", "procurement", po.internal_ref, new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(po)
    return po_to_dict(po)


@router.post("/{po_id}/approve")
def approve_po(po_id: int, payload: POApproveIn, db: Session = Depends(get_db),
               user=Depends(require_permission("invoice.approve"))):
    po = db.get(PurchaseOrder, po_id)
    if po is None:
        raise HTTPException(404, "Purchase order not found")
    if po.created_by_id == user.id and not is_super_admin(user):
        raise HTTPException(403, "You cannot approve a purchase order you created")
    if po.status != "pending_approval":
        raise HTTPException(409, f"Purchase order status '{po.status}' cannot be approved or rejected")
    if payload.approve:
        po.status = "approved"
        po.approved_by_id = user.id
    else:
        po.status = "cancelled"
    db.flush()
    audit_log(db, user.id, "approve" if payload.approve else "reject", "procurement",
              po.internal_ref, reason=payload.reason)
    db.commit()
    return po_to_dict(po)


@router.post("/{po_id}/cancel")
def cancel_po(po_id: int, payload: POApproveIn, db: Session = Depends(get_db),
              user=Depends(require_permission("invoice.approve"))):
    po = db.get(PurchaseOrder, po_id)
    if po is None:
        raise HTTPException(404, "Purchase order not found")
    if po.status != "approved" or any(i.qty_received > 0 for i in po.items):
        raise HTTPException(409, "Only an approved purchase order with nothing received can be cancelled")
    po.status = "cancelled"
    db.flush()
    audit_log(db, user.id, "cancel", "procurement", po.internal_ref, reason=payload.reason)
    db.commit()
    return po_to_dict(po)


@router.post("/{po_id}/receive")
def receive_po(po_id: int, payload: POReceiveIn, db: Session = Depends(get_db),
               user=Depends(require_permission("inventory.receive"))):
    po = db.get(PurchaseOrder, po_id)
    if po is None:
        raise HTTPException(404, "Purchase order not found")
    if po.status not in ("approved", "partially_received"):
        raise HTTPException(409, f"Goods cannot be received on a purchase order that is '{po.status}'")
    if db.get(Warehouse, payload.warehouse_id) is None:
        raise HTTPException(404, "Warehouse not found")
    lines = [l for l in payload.items if l.quantity > 0]
    if not lines:
        raise HTTPException(422, "Enter a quantity for at least one item")

    by_id = {i.id: i for i in po.items}
    seen: set[int] = set()
    received_value = Decimal("0")
    for l in lines:
        item = by_id.get(l.item_id)
        if item is None:
            raise HTTPException(422, f"Item {l.item_id} is not on this purchase order")
        if l.item_id in seen:
            raise HTTPException(422, "The same item was listed twice")
        seen.add(l.item_id)
        outstanding = item.quantity - item.qty_received
        if l.quantity > outstanding:
            raise HTTPException(409, f"Only {outstanding} still outstanding for product {item.product_id}")
        stock_service.receive_stock(
            db, item.product_id, payload.warehouse_id, l.quantity,
            payload.batch_no, payload.expiry_date, payload.reference or po.internal_ref,
            user.id, f"Received against {po.internal_ref}",
        )
        item.qty_received += l.quantity
        received_value += Decimal(l.quantity) * item.unit_cost

    po.status = "fully_received" if all(i.qty_received >= i.quantity for i in po.items) else "partially_received"
    db.flush()
    if received_value > 0:
        # Dr Inventory, Cr Accounts Payable: what we now owe the supplier
        post_entry(db, entry_date=date.today(), narration=f"Goods received on {po.internal_ref}",
                   source="goods_received", source_ref=po.internal_ref,
                   lines=[("1200", received_value, Decimal("0")), ("2000", Decimal("0"), received_value)])
    audit_log(db, user.id, "receive", "procurement", po.internal_ref, new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(po)
    return po_to_dict(po)