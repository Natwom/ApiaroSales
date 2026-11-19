from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.core.security import (
    verify_password, create_access_token, create_refresh_token, decode_token, hash_password,
)
from app.core.permissions import ROLE_PERMISSIONS
from app.models.identity import User, Role, Permission
from app.schemas.auth import LoginRequest, TokenResponse, UserOut
from app.api.v1.deps import get_current_user, user_permissions
from app.services.audit import log as audit_log

router = APIRouter(prefix="/auth", tags=["auth"])


def seed_rbac(db: Session) -> None:
    """Idempotent RBAC seeding (called at startup)."""
    for role_name, perm_codes in ROLE_PERMISSIONS.items():
        role = db.execute(select(Role).where(Role.name == role_name)).scalar_one_or_none()
        if role is None:
            role = Role(name=role_name)
            db.add(role)
            db.flush()
        for code in perm_codes:
            perm = db.execute(select(Permission).where(Permission.code == code)).scalar_one_or_none()
            if perm is None:
                perm = Permission(code=code)
                db.add(perm)
                db.flush()
            if perm not in role.permissions:
                role.permissions.append(perm)
    db.commit()


def seed_super_admin(db: Session, email: str, password: str, full_name: str) -> None:
    existing = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if existing:
        return
    role = db.execute(select(Role).where(Role.name == "Super Administrator")).scalar_one()
    user = User(full_name=full_name, email=email, password_hash=hash_password(password), roles=[role])
    db.add(user)
    db.commit()


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.execute(select(User).where(User.email == payload.email)).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    if not user.is_active:
        raise HTTPException(403, "Account deactivated")
    audit_log(db, user.id, "login", "auth", user.email)
    db.commit()
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: dict, db: Session = Depends(get_db)):
    user_id = decode_token(payload.get("refresh_token", ""), "refresh")
    if user_id is None:
        raise HTTPException(401, "Invalid refresh token")
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(401, "Invalid refresh token")
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut(
        id=user.id, full_name=user.full_name, email=user.email,
        is_active=user.is_active,
        roles=[r.name for r in user.roles],
        permissions=sorted(user_permissions(user)),
    )