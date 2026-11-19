from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import Worker
from app.schemas.worker import WorkerIn, WorkerOut
from app.api.v1.deps import require_permission
from app.services.audit import log as audit_log

router = APIRouter(prefix="/workers", tags=["workers"])


class WorkerAuthIn(BaseModel):
    collection_authorized: Optional[bool] = None
    auth_start_date: Optional[date] = None
    auth_expiry_date: Optional[date] = None


@router.get("", response_model=list[WorkerOut])
def list_workers(organization_id: int | None = None, search: str | None = None,
                 db: Session = Depends(get_db),
                 user=Depends(require_permission("worker.create"))):
    q = select(Worker).order_by(Worker.full_name)
    if organization_id:
        q = q.where(Worker.organization_id == organization_id)
    if search:
        q = q.where(Worker.full_name.ilike(f"%{search}%"))
    return db.execute(q).scalars().all()


@router.post("", response_model=WorkerOut, status_code=201)
def create_worker(payload: WorkerIn, db: Session = Depends(get_db),
                  user=Depends(require_permission("worker.create"))):
    dup = db.execute(select(Worker).where(
        Worker.organization_id == payload.organization_id,
        Worker.employee_no == payload.employee_no,
    )).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "Employee number already exists for this organization")
    worker = Worker(**payload.model_dump())
    db.add(worker)
    db.flush()
    audit_log(db, user.id, "create", "workers", worker.employee_no,
              new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(worker)
    return worker


@router.patch("/{worker_id}/authorization", response_model=WorkerOut)
def update_authorization(worker_id: int, payload: WorkerAuthIn, db: Session = Depends(get_db),
                         user=Depends(require_permission("worker.authorize"))):
    worker = db.get(Worker, worker_id)
    if worker is None:
        raise HTTPException(404, "Worker not found")
    sent = payload.model_fields_set
    if "collection_authorized" in sent and payload.collection_authorized is not None:
        worker.collection_authorized = payload.collection_authorized
    if "auth_start_date" in sent:
        worker.auth_start_date = payload.auth_start_date
    if "auth_expiry_date" in sent:
        worker.auth_expiry_date = payload.auth_expiry_date
    if (worker.auth_start_date and worker.auth_expiry_date
            and worker.auth_expiry_date < worker.auth_start_date):
        raise HTTPException(422, "Expiry date cannot be before the start date")
    db.flush()
    audit_log(db, user.id, "update", "workers", worker.employee_no,
              new=payload.model_dump(mode="json", exclude_unset=True))
    db.commit()
    db.refresh(worker)
    return worker


def assert_worker_authorized(worker: Worker) -> None:
    today = date.today()
    if not worker.collection_authorized:
        raise HTTPException(403, "Worker is not authorized to collect goods")
    if worker.auth_expiry_date and worker.auth_expiry_date < today:
        raise HTTPException(403, "Worker collection authorization has expired")
    if worker.auth_start_date and worker.auth_start_date > today:
        raise HTTPException(403, "Worker collection authorization has not started")