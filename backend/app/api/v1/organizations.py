from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import Organization
from app.schemas.organization import OrganizationIn, OrganizationOut
from app.api.v1.deps import require_permission
from app.services.audit import log as audit_log

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.get("", response_model=list[OrganizationOut])
def list_organizations(search: str | None = None, db: Session = Depends(get_db),
                       user=Depends(require_permission("organization.create"))):
    q = select(Organization).order_by(Organization.name)
    if search:
        q = q.where(Organization.name.ilike(f"%{search}%"))
    return db.execute(q).scalars().all()


@router.post("", response_model=OrganizationOut, status_code=201)
def create_organization(payload: OrganizationIn, db: Session = Depends(get_db),
                        user=Depends(require_permission("organization.create"))):
    dup = db.execute(
        select(Organization).where(Organization.name == payload.name)
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "An organization with this name already exists")
    org = Organization(**payload.model_dump())
    db.add(org)
    db.flush()
    audit_log(db, user.id, "create", "organizations", org.name, new=payload.model_dump())
    db.commit()
    db.refresh(org)
    return org


@router.get("/{org_id}", response_model=OrganizationOut)
def get_organization(org_id: int, db: Session = Depends(get_db),
                     user=Depends(require_permission("organization.create"))):
    org = db.get(Organization, org_id)
    if org is None:
        raise HTTPException(404, "Organization not found")
    return org


@router.put("/{org_id}", response_model=OrganizationOut)
def update_organization(org_id: int, payload: OrganizationIn, db: Session = Depends(get_db),
                        user=Depends(require_permission("organization.update"))):
    org = db.get(Organization, org_id)
    if org is None:
        raise HTTPException(404, "Organization not found")
    old = {c.name: getattr(org, c.name) for c in org.__table__.columns}
    for k, v in payload.model_dump().items():
        setattr(org, k, v)
    audit_log(db, user.id, "update", "organizations", org.name, old=old, new=payload.model_dump())
    db.commit()
    db.refresh(org)
    return org