from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models.finance import DocumentSequence


PREFIXES = {
    "LPO": "API-LPO", "ORD": "API-ORD", "COL": "API-COL", "INV": "API-INV",
    "CN": "API-CN", "CP": "API-CP", "SP": "API-SP", "PO": "API-PO",
    "GRN": "API-GRN", "DN": "API-DN", "EXP": "API-EXP",
}


def next_reference(db: Session, doc_type: str) -> str:
    """Atomically increments the sequence inside the caller's transaction.
    Uses UPDATE ... RETURNING-style pattern via select-for-update."""
    prefix = PREFIXES[doc_type]
    seq = db.execute(
        select(DocumentSequence).where(DocumentSequence.doc_type == doc_type).with_for_update()
    ).scalar_one_or_none()
    if seq is None:
        seq = DocumentSequence(doc_type=doc_type, prefix=prefix, current_value=0)
        db.add(seq)
        db.flush()
    seq.current_value += 1
    db.flush()
    return f"{prefix}-{seq.current_value:05d}"