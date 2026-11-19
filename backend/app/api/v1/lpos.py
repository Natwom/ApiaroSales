from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import LPO, LPOItem, CustomerOrder, CustomerOrderItem, Worker
from app.schemas.sales import LPOIn, LPOApproveIn
from app.api.v1.deps import require_permission, is_super_admin
from app.services.numbering import next_reference
from app.services.audit import log as audit_log
from decimal import Decimal

router = APIRouter(prefix="/lpos", tags=["lpos"])


def lpo_balances(db: Session, lpo_id: int) -> dict[int, tuple[int, int]]:
    """product_id -> (ordered_qty, collected_qty) across all orders on this LPO."""
    rows = db.execute(
        select(
            CustomerOrderItem.product_id,
            func.coalesce(func.sum(CustomerOrderItem.quantity), 0),
            func.coalesce(func.sum(CustomerOrderItem.qty_collected), 0),
        )
        .join(CustomerOrder, CustomerOrder.id == CustomerOrderItem.order_id)
        .where(CustomerOrder.lpo_id == lpo_id)
        .group_by(CustomerOrderItem.product_id)
    ).all()
    return {pid: (int(o), int(c)) for pid, o, c in rows}


def refresh_lpo_status(db: Session, lpo: LPO) -> None:
    """Mark the LPO partially/fully fulfilled from what has actually been collected."""
    if lpo.status not in ("approved", "partially_fulfilled", "fully_fulfilled"):
        return
    bal = lpo_balances(db, lpo.id)
    exhausted = all(bal.get(i.product_id, (0, 0))[1] >= i.authorized_qty for i in lpo.items)
    any_collected = any(c > 0 for _, c in bal.values())
    if exhausted:
        lpo.status = "fully_fulfilled"
    elif any_collected:
        lpo.status = "partially_fulfilled"


def lpo_to_dict(db: Session, lpo: LPO) -> dict:
    bal = lpo_balances(db, lpo.id)
    items = []
    tot_auth = tot_ordered = tot_collected = 0
    remaining_value = Decimal("0")
    for i in lpo.items:
        ordered, collected = bal.get(i.product_id, (0, 0))
        left_collect = max(i.authorized_qty - collected, 0)
        tot_auth += i.authorized_qty
        tot_ordered += ordered
        tot_collected += collected
        remaining_value += Decimal(left_collect) * i.unit_price
        items.append({
            "id": i.id, "product_id": i.product_id,
            "authorized_qty": i.authorized_qty, "unit_price": str(i.unit_price),
            "ordered_qty": ordered,
            "collected_qty": collected,
            "supplied_qty": collected,
            "remaining_to_order": max(i.authorized_qty - ordered, 0),
            "remaining_qty": left_collect,
        })
    return {
        "id": lpo.id,
        "internal_ref": lpo.internal_ref,
        "customer_lpo_no": lpo.customer_lpo_no,
        "organization_id": lpo.organization_id,
        "worker_id": lpo.worker_id,
        "issue_date": lpo.issue_date,
        "expiry_date": lpo.expiry_date,
        "authorized_total": str(lpo.authorized_total),
        "status": lpo.status,
        "terms": lpo.terms,
        "total_authorized_qty": tot_auth,
        "total_ordered_qty": tot_ordered,
        "total_collected_qty": tot_collected,
        "total_remaining_to_order": max(tot_auth - tot_ordered, 0),
        "total_remaining_qty": max(tot_auth - tot_collected, 0),
        "remaining_value": str(remaining_value),
        "items": items,
    }


@router.get("")
def list_lpos(status: str | None = None, organization_id: int | None = None,
              worker_id: int | None = None,
              db: Session = Depends(get_db),
              user=Depends(require_permission("lpo.create"))):
    q = select(LPO).order_by(LPO.id.desc())
    if status:
        q = q.where(LPO.status == status)
    if organization_id:
        q = q.where(LPO.organization_id == organization_id)
    if worker_id:
        q = q.where(LPO.worker_id == worker_id)
    return [lpo_to_dict(db, l) for l in db.execute(q).scalars().all()]


@router.post("", status_code=201)
def create_lpo(payload: LPOIn, db: Session = Depends(get_db),
               user=Depends(require_permission("lpo.create"))):
    dup = db.execute(select(LPO).where(
        LPO.organization_id == payload.organization_id,
        LPO.customer_lpo_no == payload.customer_lpo_no,
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "This LPO number is already registered for this customer")

    worker = db.get(Worker, payload.worker_id)
    if worker is None or worker.organization_id != payload.organization_id:
        raise HTTPException(422, "This worker does not belong to the selected customer")

    product_ids = [i.product_id for i in payload.items]
    if len(set(product_ids)) != len(product_ids):
        raise HTTPException(422, "A product can appear only once on an LPO")

    total = sum(Decimal(str(i.authorized_qty)) * i.unit_price for i in payload.items)
    lpo = LPO(
        internal_ref=next_reference(db, "LPO"),
        customer_lpo_no=payload.customer_lpo_no,
        organization_id=payload.organization_id,
        worker_id=payload.worker_id,
        issue_date=payload.issue_date,
        expiry_date=payload.expiry_date,
        terms=payload.terms,
        authorized_total=total,
        status="submitted",
        entered_by_id=user.id,
    )
    lpo.items = [
        LPOItem(product_id=i.product_id, authorized_qty=i.authorized_qty, unit_price=i.unit_price)
        for i in payload.items
    ]
    db.add(lpo)
    db.flush()
    audit_log(db, user.id, "create", "lpos", lpo.internal_ref, new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(lpo)
    return lpo_to_dict(db, lpo)


@router.post("/{lpo_id}/approve")
def approve_lpo(lpo_id: int, payload: LPOApproveIn, db: Session = Depends(get_db),
                user=Depends(require_permission("lpo.approve"))):
    lpo = db.get(LPO, lpo_id)
    if lpo is None:
        raise HTTPException(404, "LPO not found")
    if lpo.entered_by_id == user.id and not is_super_admin(user):
        raise HTTPException(403, "You cannot approve an LPO you entered")
    if lpo.status not in ("submitted", "under_review"):
        raise HTTPException(409, f"LPO status '{lpo.status}' cannot be transitioned")

    if payload.approve:
        lpo.status = "approved"
        lpo.approved_by_id = user.id
    else:
        lpo.status = "draft"
    db.flush()
    audit_log(db, user.id, "approve" if payload.approve else "reject",
              "lpos", lpo.internal_ref, reason=payload.reason)
    db.commit()
    return lpo_to_dict(db, lpo)


@router.get("/{lpo_id}/fulfillment")
def lpo_fulfillment(lpo_id: int, db: Session = Depends(get_db),
                    user=Depends(require_permission("lpo.create"))):
    """Per-item: authorized vs ordered vs collected vs remaining."""
    lpo = db.get(LPO, lpo_id)
    if lpo is None:
        raise HTTPException(404, "LPO not found")
    data = lpo_to_dict(db, lpo)
    return {"lpo": data, "items": data["items"]}