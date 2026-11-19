from datetime import date, datetime

from sqlalchemy import String, Integer, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.session import Base
from app.database.base import TimestampMixin


class PurchaseOrder(Base, TimestampMixin):
    __tablename__ = "purchase_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    internal_ref: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # API-PO-00001
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    order_date: Mapped[date] = mapped_column(Date)
    expected_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), default="pending_approval", index=True)
    # pending_approval / approved / partially_received / fully_received / cancelled
    total: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    notes: Mapped[str | None] = mapped_column(String(500))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    items: Mapped[list["PurchaseOrderItem"]] = relationship(back_populates="po", cascade="all, delete-orphan")


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    po_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_cost: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    qty_received: Mapped[int] = mapped_column(Integer, default=0)
    po: Mapped[PurchaseOrder] = relationship(back_populates="items")


class Delivery(Base, TimestampMixin):
    __tablename__ = "deliveries"
    id: Mapped[int] = mapped_column(primary_key=True)
    internal_ref: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # API-DEL-00001
    collection_id: Mapped[int] = mapped_column(ForeignKey("collections.id"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("customer_orders.id"), index=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    driver_name: Mapped[str] = mapped_column(String(200))
    vehicle_reg: Mapped[str | None] = mapped_column(String(50))
    delivery_address: Mapped[str | None] = mapped_column(String(500))
    scheduled_date: Mapped[date] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(30), default="scheduled", index=True)
    # scheduled / in_transit / delivered / failed
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    received_by_name: Mapped[str | None] = mapped_column(String(200))
    failure_reason: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(String(500))
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    confirmed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))