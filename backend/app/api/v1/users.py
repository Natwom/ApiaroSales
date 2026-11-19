from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.identity import User, Role
from app.core.security import hash_password, verify_password
from app.api.v1.deps import require_permission, get_current_user, is_super_admin
from app.services.audit import log as audit_log

router = APIRouter(prefix="/users", tags=["users"])
SUPER = "Super Administrator"


class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    phone: Optional[str] = None
    password: str
    role_ids: list[int]


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    is_active: Optional[bool] = None
    role_ids: Optional[list[int]] = None
    password: Optional[str] = None


class PasswordIn(BaseModel):
    current_password: str
    new_password: str


def to_dict(u: User) -> dict:
    return {"id": u.id, "full_name": u.full_name, "email": u.email, "phone": u.phone,
            "is_active": u.is_active, "roles": [r.name for r in u.roles], "role_ids": [r.id for r in u.roles]}


def _is_super(u: User) -> bool:
    return any(r.name == SUPER for r in u.roles)


def _roles(db: Session, ids: list[int]) -> list[Role]:
    if not ids:
        raise HTTPException(422, "Choose at least one role")
    roles = db.execute(select(Role).where(Role.id.in_(set(ids)))).scalars().all()
    if len(roles) != len(set(ids)):
        raise HTTPException(422, "One of the roles does not exist")
    return roles


@router.get("")
def list_users(db: Session = Depends(get_db), user=Depends(require_permission("user.manage"))):
    return [to_dict(u) for u in db.execute(select(User).order_by(User.full_name)).scalars().all()]


@router.get("/roles")
def list_roles(db: Session = Depends(get_db), user=Depends(require_permission("user.manage"))):
    return [{"id": r.id, "name": r.name, "permissions": sorted(p.code for p in r.permissions)}
            for r in db.execute(select(Role).order_by(Role.id)).scalars().all()]


@router.post("", status_code=201)
def create_user(payload: UserCreate, db: Session = Depends(get_db),
                user=Depends(require_permission("user.manage"))):
    email = payload.email.lower().strip()
    if db.execute(select(User).where(User.email == email)).scalar_one_or_none():
        raise HTTPException(409, "A user with this email already exists")
    if len(payload.password) < 8:
        raise HTTPException(422, "Password must be at least 8 characters")
    roles = _roles(db, payload.role_ids)
    if any(r.name == SUPER for r in roles) and not is_super_admin(user):
        raise HTTPException(403, "Only a Super Administrator can create another Super Administrator")
    u = User(full_name=payload.full_name.strip(), email=email, phone=payload.phone,
             password_hash=hash_password(payload.password), is_active=True, roles=roles)
    db.add(u)
    db.flush()
    audit_log(db, user.id, "create", "users", email,
              new={"full_name": u.full_name, "email": email, "roles": [r.name for r in roles]})
    db.commit()
    db.refresh(u)
    return to_dict(u)


@router.patch("/{user_id}")
def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db),
                user=Depends(require_permission("user.manage"))):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(404, "User not found")
    sent = payload.model_fields_set
    was_super = _is_super(target)

    new_active = payload.is_active if "is_active" in sent and payload.is_active is not None else target.is_active
    new_roles = _roles(db, payload.role_ids) if "role_ids" in sent and payload.role_ids is not None else list(target.roles)
    will_be_super = any(r.name == SUPER for r in new_roles)

    if target.id == user.id and not new_active:
        raise HTTPException(409, "You cannot deactivate your own account")
    if was_super != will_be_super and not is_super_admin(user):
        raise HTTPException(403, "Only a Super Administrator can grant or remove that role")
    if was_super and (not new_active or not will_be_super):
        others = [u for u in db.execute(select(User)).scalars().all()
                  if u.id != target.id and u.is_active and _is_super(u)]
        if not others:
            raise HTTPException(409, "There must always be at least one active Super Administrator")

    changed = {}
    if "full_name" in sent and payload.full_name:
        target.full_name = payload.full_name.strip(); changed["full_name"] = target.full_name
    if "phone" in sent:
        target.phone = payload.phone; changed["phone"] = payload.phone
    if new_active != target.is_active:
        target.is_active = new_active; changed["is_active"] = new_active
    if "role_ids" in sent and payload.role_ids is not None:
        target.roles = new_roles; changed["roles"] = [r.name for r in new_roles]
    if "password" in sent and payload.password:
        if len(payload.password) < 8:
            raise HTTPException(422, "Password must be at least 8 characters")
        target.password_hash = hash_password(payload.password); changed["password"] = "reset"
    db.flush()
    audit_log(db, user.id, "update", "users", target.email, new=changed)
    db.commit()
    db.refresh(target)
    return to_dict(target)


@router.post("/me/password")
def change_my_password(payload: PasswordIn, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(400, "Your current password is incorrect")
    if len(payload.new_password) < 8:
        raise HTTPException(422, "New password must be at least 8 characters")
    user.password_hash = hash_password(payload.new_password)
    db.flush()
    audit_log(db, user.id, "update", "users", user.email, new={"password": "changed by user"})
    db.commit()
    return {"status": "ok"}