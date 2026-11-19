from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import (
    CustomerOrder, CustomerOrderItem, Collection, CollectionItem, Worker, LPO,
)
from app.schemas.sales import CollectionIn
from app.api.v1.deps import require_permission
from app.services.numbering import next_reference
from app.services import stock as stock_service
from app.services.audit import log as audit_log
from app.api.v1.workers import assert_worker_authorized
from app.api.v1.lpos import refresh_lpo_status

DEFAULT_WAREHOUSE_ID = 1  # resolved dynamically in full build

router = APIRouter(prefix="/collections", tags=["collections"])


@router.get("")
def list_collections(organization_id: int | None = None, worker_id: int | None = None,
                     db: Session = Depends(get_db),
                     user=Depends(require_permission("collection.issue"))):
    q = select(Collection).order_by(Collection.id.desc())
    if organization_id:
        q = q.where(Collection.organization_id == organization_id)
    if worker_id:
        q = q.where(Collection.worker_id == worker_id)
    cols = db.execute(q).scalars().all()
    return [{
        "id": c.id, "internal_ref": c.internal_ref,
        "organization_id": c.organization_id, "order_id": c.order_id,
        "worker_id": c.worker_id, "recipient_name": c.recipient_name,
        "collected_at": c.collected_at,
        "items": [
            {"product_id": i.product_id, "quantity": i.quantity,
             "unit_price": str(i.unit_price), "remaining_after": i.remaining_after}
            for i in c.items
        ],
    } for c in cols]


@router.post("", status_code=201)
def create_collection(payload: CollectionIn, db: Session = Depends(get_db),
                      user=Depends(require_permission("collection.issue"))):
    order = db.get(CustomerOrder, payload.order_id)
    if order is None or order.organization_id != payload.organization_id:
        raise HTTPException(404, "Order not found for this organization")
    if order.status not in ("approved", "partially_fulfilled"):
        raise HTTPException(409, f"Order status '{order.status}' does not allow collection")

    worker = db.get(Worker, payload.worker_id)
    if worker is None or worker.organization_id != payload.organization_id:
        raise HTTPException(404, "Worker not found for this organization")
    if order.worker_id is None:
        raise HTTPException(409, "This order has no owner worker assigned")
    if order.worker_id != worker.id:
        raise HTTPException(403, "This order belongs to another worker. Only its owner can collect against it.")
    assert_worker_authorized(worker)

    order_items = {i.id: i for i in order.items}
    collection = Collection(
        internal_ref=next_reference(db, "COL"),
        organization_id=payload.organization_id,
        lpo_id=order.lpo_id,
        order_id=order.id,
        worker_id=worker.id,
        issued_by_id=user.id,
        recipient_name=payload.recipient_name or worker.full_name,
    )
    db.add(collection)
    db.flush()

    for line in payload.items:
        order_item: CustomerOrderItem | None = order_items.get(line.order_item_id)
        if order_item is None:
            raise HTTPException(422, f"Order item {line.order_item_id} not on order {order.id}")
        if line.quantity <= 0:
            raise HTTPException(422, "Collection quantity must be positive")

        remaining = order_item.quantity - order_item.qty_collected
        if line.quantity > remaining:
            raise HTTPException(409, f"Over-collection: only {remaining} remaining of product "
                                      f"{order_item.product_id} on this order")

        available = stock_service.available_stock(db, order_item.product_id, DEFAULT_WAREHOUSE_ID)
        if line.quantity > available:
            raise HTTPException(409, f"Insufficient physical stock for product "
                                      f"{order_item.product_id} (available: {available})")

        order_item.qty_collected += line.quantity
        db.add(CollectionItem(
            collection_id=collection.id,
            order_item_id=order_item.id,
            product_id=order_item.product_id,
            quantity=line.quantity,
            unit_price=order_item.unit_price,
            remaining_after=order_item.quantity - order_item.qty_collected,
        ))
        stock_service.issue_stock(
            db, order_item.product_id, DEFAULT_WAREHOUSE_ID, line.quantity,
            reference=collection.internal_ref, user_id=user.id,
            notes=f"Collection by {worker.full_name}",
        )

    all_done = all(i.qty_collected >= i.quantity for i in order.items)
    order.status = "fully_fulfilled" if all_done else "partially_fulfilled"
    db.flush()

    if order.lpo_id:
        lpo = db.get(LPO, order.lpo_id)
        if lpo:
            refresh_lpo_status(db, lpo)

    db.flush()
    audit_log(db, user.id, "create", "collections", collection.internal_ref,
              new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(collection)
    return {
        "id": collection.id,
        "internal_ref": collection.internal_ref,
        "status": "confirmed",
        "items": [
            {"product_id": i.product_id, "quantity": i.quantity,
             "unit_price": str(i.unit_price), "remaining_after": i.remaining_after}
            for i in collection.items
        ],
    }