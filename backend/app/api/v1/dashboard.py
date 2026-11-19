from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import Organization, Worker, LPO, CustomerOrder
from app.models.finance import Invoice, CustomerPayment
from app.api.v1.deps import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(db: Session = Depends(get_db), user=Depends(get_current_user)):
    def cnt(model):
        return db.execute(select(func.count()).select_from(model)).scalar_one()

    def s(model, col):
        return db.execute(select(func.coalesce(func.sum(col), 0))).scalar_one()

    active_lpo_value = db.execute(
        select(func.coalesce(func.sum(LPO.authorized_total), 0)).where(
            LPO.status.in_(["approved", "partially_fulfilled"])
        )
    ).scalar_one()

    return {
        "organizations": cnt(Organization),
        "workers": cnt(Worker),
        "total_lpos": cnt(LPO),
        "active_lpos": db.execute(select(func.count()).select_from(LPO).where(
            LPO.status.in_(["approved", "partially_fulfilled"]))).scalar_one(),
        "active_lpo_value": str(active_lpo_value),
        "total_orders": cnt(CustomerOrder),
        "total_invoiced": str(s(Invoice, Invoice.total)),
        "total_paid": str(s(Invoice, Invoice.paid_amount)),
        "outstanding_balance": str(s(Invoice, Invoice.total) - s(Invoice, Invoice.paid_amount)),
        "pending_collections": db.execute(select(func.count()).select_from(CustomerOrder).where(
            CustomerOrder.status == "approved")).scalar_one(),
        "verified_payments_total": str(
            db.execute(select(func.coalesce(func.sum(CustomerPayment.amount), 0)).where(
                CustomerPayment.status == "verified")).scalar_one()
        ),
    }