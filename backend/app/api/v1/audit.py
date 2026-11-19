from fastapi import APIRouter, Depends
from sqlalchemy import select, distinct
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.identity import AuditLog, User
from app.api.v1.deps import require_permission

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
def list_audit(module: str | None = None, action: str | None = None, user_id: int | None = None,
               search: str | None = None, limit: int = 500, db: Session = Depends(get_db),
               user=Depends(require_permission("report.export"))):
    q = (select(AuditLog, User.full_name)
         .outerjoin(User, User.id == AuditLog.user_id)
         .order_by(AuditLog.id.desc())
         .limit(max(1, min(limit, 2000))))
    if module:
        q = q.where(AuditLog.module == module)
    if action:
        q = q.where(AuditLog.action == action)
    if user_id:
        q = q.where(AuditLog.user_id == user_id)
    if search:
        like = f"%{search}%"
        q = q.where(AuditLog.record_ref.ilike(like) | AuditLog.reason.ilike(like))
    return [{
        "id": a.id, "user_id": a.user_id, "user": name or "System", "action": a.action,
        "module": a.module, "record_ref": a.record_ref, "reason": a.reason,
        "old_values": a.old_values, "new_values": a.new_values, "created_at": a.created_at,
    } for a, name in db.execute(q).all()]


@router.get("/modules")
def modules(db: Session = Depends(get_db), user=Depends(require_permission("report.export"))):
    return sorted(m for (m,) in db.execute(select(distinct(AuditLog.module))).all())