from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.finance import Account, JournalEntry, JournalLine
from app.services.refs import next_ref

DEFAULT_ACCOUNTS = [
    ("1000", "Cash / Bank", "asset"),
    ("1100", "Accounts Receivable", "asset"),
    ("1200", "Inventory", "asset"),
    ("2000", "Accounts Payable", "liability"),
    ("2200", "Tax Payable", "liability"),
    ("3000", "Owner's Equity", "equity"),
    ("4000", "Sales Revenue", "revenue"),
    ("5000", "Operating Expenses", "expense"),
    ("5100", "Cost of Goods Sold", "expense"),
]


def ensure_accounts(db: Session) -> dict[str, Account]:
    """Create any default account that is missing and return all accounts by code."""
    existing = {a.code: a for a in db.execute(select(Account)).scalars().all()}
    for code, name, typ in DEFAULT_ACCOUNTS:
        if code not in existing:
            a = Account(code=code, name=name, account_type=typ)
            db.add(a)
            existing[code] = a
    db.flush()
    return existing


def post_entry(db: Session, *, entry_date: date, narration: str, source: str,
               source_ref: str | None, lines: list[tuple[str, Decimal, Decimal]]) -> JournalEntry:
    """Post a balanced journal entry. lines = [(account_code, debit, credit)]. Caller commits."""
    accounts = ensure_accounts(db)
    for code, _, _ in lines:
        if code not in accounts:
            raise HTTPException(422, f"Unknown account {code}")
    debit = sum((Decimal(str(d)) for _, d, _ in lines), Decimal("0"))
    credit = sum((Decimal(str(c)) for _, _, c in lines), Decimal("0"))
    if debit != credit or debit <= 0:
        raise HTTPException(422, "Journal entry does not balance")
    entry = JournalEntry(
        entry_no=next_ref(db, "JRNL", "API-GJ"),
        entry_date=entry_date, narration=narration[:500], source=source, source_ref=source_ref,
        lines=[
            JournalLine(account_id=accounts[code].id, debit=Decimal(str(d)), credit=Decimal(str(c)))
            for code, d, c in lines
        ],
    )
    db.add(entry)
    db.flush()
    return entry