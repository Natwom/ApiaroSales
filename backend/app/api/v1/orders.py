from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import CustomerOrder, CustomerOrderItem, LPO, LPOItem, Worker
from app.schemas.sales import OrderIn
from app.api.v1.deps import require_permission, is_super_admin
from app.services.numbering import next_reference
from app.services.audit import log as audit_log
from decimal import Decimal, ROUND_HALF_UP

router = APIRouter(prefix="/orders", tags=["orders"])


def order_to_dict(order: CustomerOrder) -> dict:
    return {
        "id": order.id,
        "internal_ref": order.internal_ref,
        "organization_id": order.organization_id,
        "lpo_id": order.lpo_id,
        "worker_id": order.worker_id,
        "status": order.status,
        "total": str(order.total),
        "tax_rate": str(order.tax_rate),
        "items": [
            {
                "id": i.id, "product_id": i.product_id, "quantity": i.quantity,
                "unit_price": str(i.unit_price),
                "qty_collected": i.qty_collected,
                "remaining_qty": i.quantity - i.qty_collected,
            } for i in order.items
        ],
    }


@router.get("")
def list_orders(status: str | None = None, organization_id: int | None = None,
                worker_id: int | None = None,
                db: Session = Depends(get_db),
                user=Depends(require_permission("order.create"))):
    q = select(CustomerOrder).order_by(CustomerOrder.id.desc())
    if status:
        q = q.where(CustomerOrder.status == status)
    if organization_id:
        q = q.where(CustomerOrder.organization_id == organization_id)
    if worker_id:
        q = q.where(CustomerOrder.worker_id == worker_id)
    return [order_to_dict(o) for o in db.execute(q).scalars().all()]


@router.post("", status_code=201)
def create_order(payload: OrderIn, db: Session = Depends(get_db),
                 user=Depends(require_permission("order.create"))):
    if not payload.items:
        raise HTTPException(422, "Order must contain at least one item")

    if not payload.worker_id:
        raise HTTPException(422, "A worker must be selected for every order")
    worker = db.get(Worker, payload.worker_id)
    if worker is None or worker.organization_id != payload.organization_id:
        raise HTTPException(422, "This worker does not belong to the selected customer")

    subtotal = Decimal("0")
    items: list[CustomerOrderItem] = []

    if payload.lpo_id:
        lpo = db.get(LPO, payload.lpo_id)
        if lpo is None:
            raise HTTPException(404, "LPO not found")
        if lpo.status == "fully_fulfilled":
            raise HTTPException(409, "This LPO is exhausted: everything on it has been collected")
        if lpo.status not in ("approved", "partially_fulfilled"):
            raise HTTPException(409, "A valid approved LPO is required")
        if lpo.organization_id != payload.organization_id:
            raise HTTPException(422, "This LPO belongs to a different customer")
        if lpo.worker_id is None:
            raise HTTPException(409, "This LPO has no owner worker assigned. Assign one before ordering.")
        if lpo.worker_id != payload.worker_id:
            raise HTTPException(403, "This LPO belongs to another worker. Only its owner can order against it.")

        lpo_items = {i.product_id: i for i in lpo.items}
        existing = db.execute(
            select(CustomerOrder).where(CustomerOrder.lpo_id == payload.lpo_id)
        ).scalars().all()
        already_ordered: dict[int, int] = {}
        for o in existing:
            for oi in o.items:
                already_ordered[oi.product_id] = already_ordered.get(oi.product_id, 0) + oi.quantity

        requested: dict[int, int] = {}
        for i in payload.items:
            lpo_item: LPOItem | None = lpo_items.get(i.product_id)
            if lpo_item is None:
                raise HTTPException(422, f"Product {i.product_id} is not on the LPO")
            if i.quantity <= 0:
                raise HTTPException(422, "Quantity must be positive")
            requested[i.product_id] = requested.get(i.product_id, 0) + i.quantity
            left = lpo_item.authorized_qty - already_ordered.get(i.product_id, 0)
            if requested[i.product_id] > left:
                raise HTTPException(409, f"Only {max(left, 0)} left on the LPO for product {i.product_id} "
                                          f"(authorized {lpo_item.authorized_qty}); you asked for {requested[i.product_id]}")
    else:
        for i in payload.items:
            if i.quantity <= 0:
                raise HTTPException(422, "Quantity must be positive")

    for i in payload.items:
        line = Decimal(str(i.quantity)) * i.unit_price
        subtotal += line
        items.append(CustomerOrderItem(
            product_id=i.product_id, quantity=i.quantity, unit_price=i.unit_price,
        ))

    subtotal = subtotal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    discount = Decimal(payload.discount).quantize(Decimal("0.01"))
    taxable = max(subtotal - discount, Decimal("0"))
    tax = (taxable * Decimal(payload.tax_rate) / Decimal("100")).quantize(Decimal("0.01"))
    total = taxable + tax

    order = CustomerOrder(
        internal_ref=next_reference(db, "ORD"),
        organization_id=payload.organization_id,
        lpo_id=payload.lpo_id,
        worker_id=payload.worker_id,
        required_date=payload.required_date,
        discount=discount, tax_rate=payload.tax_rate, total=total,
        status="pending_approval",
        created_by_id=user.id,
        items=items,
    )
    db.add(order)
    db.flush()
    audit_log(db, user.id, "create", "orders", order.internal_ref,
              new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(order)
    return order_to_dict(order)


@router.post("/{order_id}/approve")
def approve_order(order_id: int, db: Session = Depends(get_db),
                  user=Depends(require_permission("order.approve"))):
    order = db.get(CustomerOrder, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    if order.created_by_id == user.id and not is_super_admin(user):
        raise HTTPException(403, "You cannot approve an order you created")
    if order.status != "pending_approval":
        raise HTTPException(409, f"Order status '{order.status}' cannot be approved")
    order.status = "approved"
    order.approved_by_id = user.id
    db.flush()
    audit_log(db, user.id, "approve", "orders", order.internal_ref)
    db.commit()
    return order_to_dict(order)