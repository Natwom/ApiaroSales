from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.finance import DocumentSequence


def next_ref(db: Session, doc_type: str, prefix: str) -> str:
    """Concurrency-safe document number, e.g. API-PO-00001. Caller commits."""
    seq = db.execute(
        select(DocumentSequence).where(DocumentSequence.doc_type == doc_type).with_for_update()
    ).scalar_one_or_none()
    if seq is None:
        seq = DocumentSequence(doc_type=doc_type, prefix=prefix, current_value=0)
        db.add(seq)
        db.flush()
    seq.current_value += 1
    db.flush()
    return f"{seq.prefix}-{seq.current_value:05d}"
