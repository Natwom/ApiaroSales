import json
from sqlalchemy.orm import Session
from app.models.identity import AuditLog


def log(db: Session, user_id: int | None, action: str, module: str,
        record_ref: str | None = None, old: dict | None = None,
        new: dict | None = None, reason: str | None = None) -> None:
    db.add(AuditLog(
        user_id=user_id, action=action, module=module, record_ref=record_ref,
        old_values=json.dumps(old, default=str) if old else None,
        new_values=json.dumps(new, default=str) if new else None,
        reason=reason,
    ))