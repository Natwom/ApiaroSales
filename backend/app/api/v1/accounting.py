from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.finance import Account, JournalEntry, JournalLine
from app.api.v1.deps import require_permission
from app.services.ledger import ensure_accounts, post_entry
from app.services.audit import log as audit_log

router = APIRouter(prefix="/accounting", tags=["accounting"])
TYPES = ("asset", "liability", "equity", "revenue", "expense")
DEBIT_NORMAL = ("asset", "expense")


class AccountIn(BaseModel):
    code: str
    name: str
    account_type: str


class JournalLineIn(BaseModel):
    account_code: str
    debit: Decimal = Decimal("0")
    credit: Decimal = Decimal("0")


class JournalIn(BaseModel):
    entry_date: date
    narration: str
    lines: list[JournalLineIn]


@router.get("/accounts")
def accounts(date_from: Optional[date] = None, date_to: Optional[date] = None,
             db: Session = Depends(get_db),
             user=Depends(require_permission("report.export"))):
    ensure_accounts(db)
    db.commit()
    q = (
        select(JournalLine.account_id,
               func.coalesce(func.sum(JournalLine.debit), 0),
               func.coalesce(func.sum(JournalLine.credit), 0))
        .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
        .where(JournalEntry.status == "posted")
    )
    if date_from:
        q = q.where(JournalEntry.entry_date >= date_from)
    if date_to:
        q = q.where(JournalEntry.entry_date <= date_to)
    sums = {aid: (Decimal(str(d)), Decimal(str(c))) for aid, d, c in db.execute(q.group_by(JournalLine.account_id)).all()}
    out = []
    for a in db.execute(select(Account).order_by(Account.code)).scalars().all():
        d, c = sums.get(a.id, (Decimal("0"), Decimal("0")))
        bal = d - c if a.account_type in DEBIT_NORMAL else c - d
        out.append({"id": a.id, "code": a.code, "name": a.name, "account_type": a.account_type,
                    "debit": str(d), "credit": str(c), "balance": str(bal)})
    return out


@router.post("/accounts", status_code=201)
def create_account(payload: AccountIn, db: Session = Depends(get_db),
                   user=Depends(require_permission("invoice.approve"))):
    code, name = payload.code.strip(), payload.name.strip()
    if not code or not name:
        raise HTTPException(422, "Code and name are required")
    if payload.account_type not in TYPES:
        raise HTTPException(422, f"Type must be one of {', '.join(TYPES)}")
    if db.execute(select(Account).where(Account.code == code)).scalar_one_or_none():
        raise HTTPException(409, "An account with this code already exists")
    a = Account(code=code, name=name, account_type=payload.account_type)
    db.add(a)
    db.flush()
    audit_log(db, user.id, "create", "accounting", code, new=payload.model_dump())
    db.commit()
    return {"id": a.id, "code": a.code}


@router.get("/journal")
def journal(source: Optional[str] = None, limit: int = 150, db: Session = Depends(get_db),
            user=Depends(require_permission("report.export"))):
    accts = {a.id: a for a in db.execute(select(Account)).scalars().all()}
    q = select(JournalEntry).order_by(JournalEntry.id.desc()).limit(max(1, min(limit, 500)))
    if source:
        q = q.where(JournalEntry.source == source)
    out = []
    for e in db.execute(q).scalars().all():
        out.append({
            "id": e.id, "entry_no": e.entry_no, "entry_date": e.entry_date, "narration": e.narration,
            "source": e.source, "source_ref": e.source_ref, "status": e.status,
            "total": str(sum((l.debit for l in e.lines), Decimal("0"))),
            "lines": [{
                "code": accts[l.account_id].code if l.account_id in accts else "?",
                "name": accts[l.account_id].name if l.account_id in accts else "?",
                "debit": str(l.debit), "credit": str(l.credit),
            } for l in e.lines],
        })
    return out


@router.post("/journal", status_code=201)
def manual_entry(payload: JournalIn, db: Session = Depends(get_db),
                 user=Depends(require_permission("invoice.approve"))):
    if len(payload.lines) < 2:
        raise HTTPException(422, "A journal entry needs at least two lines")
    if not payload.narration.strip():
        raise HTTPException(422, "A narration is required")
    lines = []
    for l in payload.lines:
        if l.debit < 0 or l.credit < 0 or (l.debit > 0) == (l.credit > 0):
            raise HTTPException(422, "Each line must have either a debit or a credit amount")
        lines.append((l.account_code, l.debit, l.credit))
    entry = post_entry(db, entry_date=payload.entry_date, narration=payload.narration.strip(),
                       source="manual", source_ref=None, lines=lines)
    audit_log(db, user.id, "create", "accounting", entry.entry_no, new=payload.model_dump(mode="json"))
    db.commit()
    return {"id": entry.id, "entry_no": entry.entry_no}