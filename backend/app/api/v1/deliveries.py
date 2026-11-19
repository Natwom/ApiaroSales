from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import Collection, CustomerOrder, Organization, Worker, Product
from app.models.procurement import Delivery
from app.api.v1.deps import require_permission
from app.services.refs import next_ref
from app.services.audit import log as audit_log

router = APIRouter(prefix="/deliveries", tags=["deliveries"])
ACTIVE = ("scheduled", "in_transit", "delivered")


class DeliveryIn(BaseModel):
    collection_id: int
    driver_name: str
    vehicle_reg: Optional[str] = None
    delivery_address: Optional[str] = None
    scheduled_date: date
    notes: Optional[str] = None


class ConfirmIn(BaseModel):
    received_by_name: str


class FailIn(BaseModel):
    reason: str


def _items(db: Session, col: Collection | None) -> list[dict]:
    out = []
    for i in (col.items if col else []):
        p = db.get(Product, i.product_id)
        out.append({"product_id": i.product_id, "product": p.name if p else str(i.product_id),
                    "quantity": i.quantity, "unit_price": str(i.unit_price)})
    return out


def delivery_to_dict(db: Session, d: Delivery) -> dict:
    col = db.get(Collection, d.collection_id)
    org = db.get(Organization, d.organization_id)
    order = db.get(CustomerOrder, d.order_id)
    worker = db.get(Worker, col.worker_id) if col else None
    return {
        "id": d.id, "internal_ref": d.internal_ref,
        "collection_id": d.collection_id, "collection_ref": col.internal_ref if col else None,
        "order_id": d.order_id, "order_ref": order.internal_ref if order else None,
        "organization_id": d.organization_id, "customer": org.name if org else None,
        "worker": worker.full_name if worker else None,
        "driver_name": d.driver_name, "vehicle_reg": d.vehicle_reg,
        "delivery_address": d.delivery_address, "scheduled_date": d.scheduled_date,
        "status": d.status, "dispatched_at": d.dispatched_at, "delivered_at": d.delivered_at,
        "received_by_name": d.received_by_name, "failure_reason": d.failure_reason,
        "notes": d.notes, "items": _items(db, col),
    }


@router.get("")
def list_deliveries(status: str | None = None, db: Session = Depends(get_db),
                    user=Depends(require_permission("delivery.confirm"))):
    q = select(Delivery).order_by(Delivery.id.desc())
    if status:
        q = q.where(Delivery.status == status)
    return [delivery_to_dict(db, d) for d in db.execute(q).scalars().all()]


@router.get("/eligible")
def eligible_collections(db: Session = Depends(get_db),
                         user=Depends(require_permission("delivery.confirm"))):
    """Collections that have no active delivery yet."""
    taken = select(Delivery.collection_id).where(Delivery.status.in_(ACTIVE))
    cols = db.execute(
        select(Collection).where(Collection.id.not_in(taken)).order_by(Collection.id.desc())
    ).scalars().all()
    out = []
    for c in cols:
        org = db.get(Organization, c.organization_id)
        order = db.get(CustomerOrder, c.order_id)
        worker = db.get(Worker, c.worker_id)
        out.append({
            "id": c.id, "internal_ref": c.internal_ref,
            "organization_id": c.organization_id, "customer": org.name if org else None,
            "delivery_address": org.delivery_address if org else None,
            "order_ref": order.internal_ref if order else None,
            "worker": worker.full_name if worker else None,
            "recipient_name": c.recipient_name, "collected_at": c.collected_at,
            "items": _items(db, c),
        })
    return out


@router.post("", status_code=201)
def create_delivery(payload: DeliveryIn, db: Session = Depends(get_db),
                    user=Depends(require_permission("delivery.confirm"))):
    col = db.get(Collection, payload.collection_id)
    if col is None:
        raise HTTPException(404, "Collection not found")
    if not payload.driver_name.strip():
        raise HTTPException(422, "Driver name is required")
    active = db.execute(select(Delivery).where(
        Delivery.collection_id == col.id, Delivery.status.in_(ACTIVE))).first()
    if active:
        raise HTTPException(409, "This collection already has an active delivery")
    org = db.get(Organization, col.organization_id)
    d = Delivery(
        internal_ref=next_ref(db, "DLV", "API-DEL"),
        collection_id=col.id, order_id=col.order_id, organization_id=col.organization_id,
        driver_name=payload.driver_name.strip(), vehicle_reg=payload.vehicle_reg,
        delivery_address=payload.delivery_address or (org.delivery_address if org else None),
        scheduled_date=payload.scheduled_date, notes=payload.notes,
        status="scheduled", created_by_id=user.id,
    )
    db.add(d)
    db.flush()
    audit_log(db, user.id, "create", "deliveries", d.internal_ref, new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(d)
    return delivery_to_dict(db, d)


def _get(db: Session, delivery_id: int) -> Delivery:
    d = db.get(Delivery, delivery_id)
    if d is None:
        raise HTTPException(404, "Delivery not found")
    return d


@router.post("/{delivery_id}/dispatch")
def dispatch(delivery_id: int, db: Session = Depends(get_db),
             user=Depends(require_permission("delivery.confirm"))):
    d = _get(db, delivery_id)
    if d.status != "scheduled":
        raise HTTPException(409, f"A delivery that is '{d.status}' cannot be dispatched")
    d.status = "in_transit"
    d.dispatched_at = datetime.now(timezone.utc)
    db.flush()
    audit_log(db, user.id, "dispatch", "deliveries", d.internal_ref)
    db.commit()
    return delivery_to_dict(db, d)


@router.post("/{delivery_id}/confirm")
def confirm(delivery_id: int, payload: ConfirmIn, db: Session = Depends(get_db),
            user=Depends(require_permission("delivery.confirm"))):
    d = _get(db, delivery_id)
    if d.status not in ("scheduled", "in_transit"):
        raise HTTPException(409, f"A delivery that is '{d.status}' cannot be confirmed")
    if not payload.received_by_name.strip():
        raise HTTPException(422, "The name of the person who received the goods is required")
    d.status = "delivered"
    d.delivered_at = datetime.now(timezone.utc)
    d.received_by_name = payload.received_by_name.strip()
    d.confirmed_by_id = user.id
    db.flush()
    audit_log(db, user.id, "confirm", "deliveries", d.internal_ref, reason=d.received_by_name)
    db.commit()
    return delivery_to_dict(db, d)


@router.post("/{delivery_id}/fail")
def fail(delivery_id: int, payload: FailIn, db: Session = Depends(get_db),
         user=Depends(require_permission("delivery.confirm"))):
    d = _get(db, delivery_id)
    if d.status not in ("scheduled", "in_transit"):
        raise HTTPException(409, f"A delivery that is '{d.status}' cannot be marked as failed")
    if not payload.reason.strip():
        raise HTTPException(422, "A reason is required")
    d.status = "failed"
    d.failure_reason = payload.reason.strip()
    db.flush()
    audit_log(db, user.id, "fail", "deliveries", d.internal_ref, reason=d.failure_reason)
    db.commit()
    return delivery_to_dict(db, d)