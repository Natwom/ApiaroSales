from datetime import date

from sqlalchemy import String, Numeric, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.database.session import Base
from app.database.base import TimestampMixin


class SupplierPayment(Base, TimestampMixin):
    __tablename__ = "supplier_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    internal_ref: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # API-SP-00001
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    payment_date: Mapped[date] = mapped_column(Date)
    method: Mapped[str] = mapped_column(String(30))
    reference: Mapped[str | None] = mapped_column(String(100))
    amount: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    notes: Mapped[str | None] = mapped_column(String(500))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))