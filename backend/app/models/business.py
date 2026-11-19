from datetime import date, datetime

from sqlalchemy import String, Integer, Numeric, Date, DateTime, ForeignKey, Boolean, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.session import Base
from app.database.base import TimestampMixin


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    org_type: Mapped[str] = mapped_column(String(50), default="NGO")  # NGO/Gov/Company/School/...
    registration_no: Mapped[str | None] = mapped_column(String(100))
    contact_person: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255))
    physical_address: Mapped[str | None] = mapped_column(String(500))
    billing_address: Mapped[str | None] = mapped_column(String(500))
    delivery_address: Mapped[str | None] = mapped_column(String(500))
    tax_info: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active/inactive
    notes: Mapped[str | None] = mapped_column(String)


class Worker(Base, TimestampMixin):
    __tablename__ = "workers"
    id: Mapped[int] = mapped_column(primary_key=True)
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    full_name: Mapped[str] = mapped_column(String(200), index=True)
    employee_no: Mapped[str] = mapped_column(String(50), index=True)
    department: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255))
    employment_status: Mapped[str] = mapped_column(String(20), default="active")
    collection_authorized: Mapped[bool] = mapped_column(Boolean, default=False)
    auth_start_date: Mapped[date | None] = mapped_column(Date)
    auth_expiry_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String)
    __table_args__ = (UniqueConstraint("organization_id", "employee_no", name="uq_worker_org_empno"),)


class Supplier(Base, TimestampMixin):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    contact_person: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(String(500))
    payment_terms: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="active")


class ProductCategory(Base):
    __tablename__ = "product_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class Product(Base, TimestampMixin):
    __tablename__ = "products"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    sku: Mapped[str] = mapped_column(String(100), unique=True)
    barcode: Mapped[str | None] = mapped_column(String(100))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("product_categories.id"))
    description: Mapped[str | None] = mapped_column(String)
    unit: Mapped[str] = mapped_column(String(20), default="pcs")
    purchase_price: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    selling_price: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    reorder_level: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="active")


class Warehouse(Base):
    __tablename__ = "warehouses"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    location: Mapped[str | None] = mapped_column(String(255))


class StockBatch(Base, TimestampMixin):
    __tablename__ = "stock_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    batch_no: Mapped[str | None] = mapped_column(String(100))
    expiry_date: Mapped[date | None] = mapped_column(Date)
    qty_on_hand: Mapped[int] = mapped_column(Integer, default=0)
    qty_reserved: Mapped[int] = mapped_column(Integer, default=0)
    qty_damaged: Mapped[int] = mapped_column(Integer, default=0)


class StockMovement(Base):
    __tablename__ = "stock_movements"
    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id"))
    movement_type: Mapped[str] = mapped_column(String(30), index=True)
    # receive / issue / reserve / release / adjust / damage / return
    quantity: Mapped[int] = mapped_column(Integer)
    reference: Mapped[str | None] = mapped_column(String(100), index=True)
    notes: Mapped[str | None] = mapped_column(String(500))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LPO(Base, TimestampMixin):
    __tablename__ = "lpos"
    id: Mapped[int] = mapped_column(primary_key=True)
    internal_ref: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # API-LPO-00001
    customer_lpo_no: Mapped[str] = mapped_column(String(100), index=True)            # WV-LPO-0045
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    worker_id: Mapped[int | None] = mapped_column(ForeignKey("workers.id"), index=True)  # owner worker
    issue_date: Mapped[date] = mapped_column(Date)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    authorized_total: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    terms: Mapped[str | None] = mapped_column(String)
    entered_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("organization_id", "customer_lpo_no", name="uq_lpo_org_number"),
    )
    items: Mapped[list["LPOItem"]] = relationship(back_populates="lpo", cascade="all, delete-orphan")


class LPOItem(Base):
    __tablename__ = "lpo_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    lpo_id: Mapped[int] = mapped_column(ForeignKey("lpos.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    authorized_qty: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    lpo: Mapped[LPO] = relationship(back_populates="items")


class LPOAmendment(Base, TimestampMixin):
    __tablename__ = "lpo_amendments"
    id: Mapped[int] = mapped_column(primary_key=True)
    lpo_id: Mapped[int] = mapped_column(ForeignKey("lpos.id"), index=True)
    reason: Mapped[str] = mapped_column(String(500))
    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at_note: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LPOAmendmentItem(Base):
    __tablename__ = "lpo_amendment_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    amendment_id: Mapped[int] = mapped_column(ForeignKey("lpo_amendments.id", ondelete="CASCADE"))
    lpo_item_id: Mapped[int] = mapped_column(ForeignKey("lpo_items.id"))
    old_qty: Mapped[int | None] = mapped_column(Integer)
    new_qty: Mapped[int | None] = mapped_column(Integer)
    old_price: Mapped[Numeric | None] = mapped_column(Numeric(18, 2))
    new_price: Mapped[Numeric | None] = mapped_column(Numeric(18, 2))


class CustomerOrder(Base, TimestampMixin):
    __tablename__ = "customer_orders"
    id: Mapped[int] = mapped_column(primary_key=True)
    internal_ref: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # API-ORD-00001
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    lpo_id: Mapped[int | None] = mapped_column(ForeignKey("lpos.id"), index=True)
    worker_id: Mapped[int | None] = mapped_column(ForeignKey("workers.id"))
    required_date: Mapped[date | None] = mapped_column(Date)
    discount: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    tax_rate: Mapped[Numeric] = mapped_column(Numeric(5, 2), default=0)
    total: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    items: Mapped[list["CustomerOrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class CustomerOrderItem(Base):
    __tablename__ = "customer_order_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("customer_orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    qty_collected: Mapped[int] = mapped_column(Integer, default=0)
    order: Mapped[CustomerOrder] = relationship(back_populates="items")


class Collection(Base, TimestampMixin):
    __tablename__ = "collections"
    id: Mapped[int] = mapped_column(primary_key=True)
    internal_ref: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # API-COL-00001
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    lpo_id: Mapped[int | None] = mapped_column(ForeignKey("lpos.id"))
    order_id: Mapped[int] = mapped_column(ForeignKey("customer_orders.id"), index=True)
    worker_id: Mapped[int] = mapped_column(ForeignKey("workers.id"))
    issued_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    recipient_name: Mapped[str | None] = mapped_column(String(200))
    collected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    items: Mapped[list["CollectionItem"]] = relationship(back_populates="collection", cascade="all, delete-orphan")


class CollectionItem(Base):
    __tablename__ = "collection_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    collection_id: Mapped[int] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"), index=True)
    order_item_id: Mapped[int] = mapped_column(ForeignKey("customer_order_items.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    remaining_after: Mapped[int] = mapped_column(Integer)
    collection: Mapped[Collection] = relationship(back_populates="items")