from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import Supplier
from app.api.v1.deps import require_permission
from app.services.audit import log as audit_log

router = APIRouter(prefix="/suppliers", tags=["suppliers"])


class SupplierIn(BaseModel):
    name: str
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    payment_terms: str | None = None


def supplier_to_dict(s: Supplier) -> dict:
    return {
        "id": s.id, "name": s.name, "contact_person": s.contact_person,
        "phone": s.phone, "email": s.email, "address": s.address,
        "payment_terms": s.payment_terms, "status": s.status,
    }


@router.get("")
def list_suppliers(db: Session = Depends(get_db),
                   user=Depends(require_permission("inventory.receive"))):
    rows = db.execute(select(Supplier).order_by(Supplier.name)).scalars().all()
    return [supplier_to_dict(s) for s in rows]


@router.post("", status_code=201)
def create_supplier(payload: SupplierIn, db: Session = Depends(get_db),
                    user=Depends(require_permission("inventory.receive"))):
    dup = db.execute(select(Supplier).where(Supplier.name == payload.name)).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "A supplier with this name already exists")
    s = Supplier(**payload.model_dump())
    db.add(s)
    db.flush()
    audit_log(db, user.id, "create", "suppliers", s.name, new=payload.model_dump())
    db.commit()
    db.refresh(s)
    return supplier_to_dict(s)