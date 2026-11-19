from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.finance import Expense, ExpenseCategory
from app.models.identity import User
from app.api.v1.deps import require_permission, is_super_admin
from app.services.ledger import post_entry
from app.services.refs import next_ref
from app.services.audit import log as audit_log

router = APIRouter(prefix="/expenses", tags=["expenses"])
METHODS = {"cash", "mpesa_manual", "bank_transfer", "cheque", "other"}


class CategoryIn(BaseModel):
    name: str


class ExpenseIn(BaseModel):
    category_id: int
    description: str
    amount: Decimal
    expense_date: date
    method: str = "cash"


class DecideIn(BaseModel):
    approve: bool = True
    reason: Optional[str] = None


def serialize(db: Session, rows: list[Expense]) -> list[dict]:
    cats = {c.id: c.name for c in db.execute(select(ExpenseCategory)).scalars().all()}
    users = {u.id: u.full_name for u in db.execute(select(User)).scalars().all()}
    return [{
        "id": e.id, "internal_ref": e.internal_ref, "category_id": e.category_id,
        "category": cats.get(e.category_id), "description": e.description, "amount": str(e.amount),
        "expense_date": e.expense_date, "method": e.method, "status": e.status,
        "recorded_by": users.get(e.recorded_by_id), "approved_by": users.get(e.approved_by_id),
    } for e in rows]


@router.get("/categories")
def categories(db: Session = Depends(get_db), user=Depends(require_permission("expense.create"))):
    rows = db.execute(select(ExpenseCategory).order_by(ExpenseCategory.name)).scalars().all()
    return [{"id": c.id, "name": c.name} for c in rows]


@router.post("/categories", status_code=201)
def create_category(payload: CategoryIn, db: Session = Depends(get_db),
                    user=Depends(require_permission("expense.create"))):
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Name is required")
    if db.execute(select(ExpenseCategory).where(ExpenseCategory.name == name)).scalar_one_or_none():
        raise HTTPException(409, "Category already exists")
    c = ExpenseCategory(name=name)
    db.add(c)
    db.flush()
    audit_log(db, user.id, "create", "expenses", name)
    db.commit()
    return {"id": c.id, "name": c.name}


@router.get("")
def list_expenses(status: str | None = None, db: Session = Depends(get_db),
                  user=Depends(require_permission("expense.create"))):
    q = select(Expense).order_by(Expense.id.desc())
    if status:
        q = q.where(Expense.status == status)
    return serialize(db, db.execute(q).scalars().all())


@router.post("", status_code=201)
def create_expense(payload: ExpenseIn, db: Session = Depends(get_db),
                   user=Depends(require_permission("expense.create"))):
    if payload.amount <= 0:
        raise HTTPException(422, "Amount must be positive")
    if payload.method not in METHODS:
        raise HTTPException(422, "Unknown payment method")
    if not payload.description.strip():
        raise HTTPException(422, "Description is required")
    if db.get(ExpenseCategory, payload.category_id) is None:
        raise HTTPException(422, "Category not found")
    e = Expense(
        internal_ref=next_ref(db, "EXP", "API-EXP"), category_id=payload.category_id,
        description=payload.description.strip(), amount=payload.amount,
        expense_date=payload.expense_date, method=payload.method,
        status="pending_approval", recorded_by_id=user.id,
    )
    db.add(e)
    db.flush()
    audit_log(db, user.id, "create", "expenses", e.internal_ref, new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(e)
    return serialize(db, [e])[0]


@router.post("/{expense_id}/decide")
def decide(expense_id: int, payload: DecideIn, db: Session = Depends(get_db),
           user=Depends(require_permission("invoice.approve"))):
    e = db.get(Expense, expense_id)
    if e is None:
        raise HTTPException(404, "Expense not found")
    if e.recorded_by_id == user.id and not is_super_admin(user):
        raise HTTPException(403, "You cannot approve an expense you recorded")
    if e.status != "pending_approval":
        raise HTTPException(409, f"Expense status '{e.status}' cannot be changed")
    if payload.approve:
        e.status = "approved"
        e.approved_by_id = user.id
        post_entry(db, entry_date=e.expense_date, narration=f"Expense {e.internal_ref}: {e.description}",
                   source="expense", source_ref=e.internal_ref,
                   lines=[("5000", e.amount, Decimal("0")), ("1000", Decimal("0"), e.amount)])
    else:
        if not (payload.reason or "").strip():
            raise HTTPException(422, "A reason is required to reject")
        e.status = "rejected"
    db.flush()
    audit_log(db, user.id, "approve" if payload.approve else "reject", "expenses",
              e.internal_ref, reason=payload.reason)
    db.commit()
    return serialize(db, [e])[0]