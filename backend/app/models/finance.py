from sqlalchemy import String, Integer, Numeric, Date, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database.session import Base
from app.database.base import TimestampMixin


class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(primary_key=True)
    internal_ref: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # API-INV-00001
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    lpo_id: Mapped[int | None] = mapped_column(ForeignKey("lpos.id"))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("customer_orders.id"))
    invoice_date: Mapped[Date] = mapped_column(Date)
    due_date: Mapped[Date | None] = mapped_column(Date)
    subtotal: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    tax_amount: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    total: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    paid_amount: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    status: Mapped[str] = mapped_column(String(30), default="unpaid", index=True)
    # unpaid / partially_paid / fully_paid
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    items: Mapped[list["InvoiceItem"]] = relationship(back_populates="invoice", cascade="all, delete-orphan")


class InvoiceItem(Base):
    __tablename__ = "invoice_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    description: Mapped[str | None] = mapped_column(String(500))
    quantity: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    line_total: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    invoice: Mapped[Invoice] = relationship(back_populates="items")


class CustomerPayment(Base, TimestampMixin):
    __tablename__ = "customer_payments"
    id: Mapped[int] = mapped_column(primary_key=True)
    internal_ref: Mapped[str] = mapped_column(String(50), unique=True, index=True)  # API-CP-00001
    organization_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    payment_date: Mapped[Date] = mapped_column(Date)
    method: Mapped[str] = mapped_column(String(30))  # mpesa_manual/bank/cash/cheque/other
    transaction_ref: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    amount: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    description: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(30), default="pending_verification", index=True)
    # pending_verification / verified / rejected / reversed
    recorded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    verified_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[DateTime | None] = mapped_column(DateTime(timezone=True))
    reversal_reason: Mapped[str | None] = mapped_column(String(500))
    allocations: Mapped[list["CustomerPaymentAllocation"]] = relationship(
        back_populates="payment", cascade="all, delete-orphan"
    )


class CustomerPaymentAllocation(Base):
    __tablename__ = "customer_payment_allocations"
    id: Mapped[int] = mapped_column(primary_key=True)
    payment_id: Mapped[int] = mapped_column(ForeignKey("customer_payments.id", ondelete="CASCADE"), index=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    amount: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    payment: Mapped[CustomerPayment] = relationship(back_populates="allocations")


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)


class Expense(Base, TimestampMixin):
    __tablename__ = "expenses"
    id: Mapped[int] = mapped_column(primary_key=True)
    internal_ref: Mapped[str] = mapped_column(String(50), unique=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("expense_categories.id"))
    description: Mapped[str] = mapped_column(String(500))
    amount: Mapped[Numeric] = mapped_column(Numeric(18, 2))
    expense_date: Mapped[Date] = mapped_column(Date)
    method: Mapped[str] = mapped_column(String(30), default="cash")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    recorded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    approved_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))


class Account(Base):
    __tablename__ = "chart_of_accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    account_type: Mapped[str] = mapped_column(String(30))  # asset/liability/equity/revenue/expense


class JournalEntry(Base, TimestampMixin):
    __tablename__ = "journal_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    entry_no: Mapped[str] = mapped_column(String(50), unique=True)
    entry_date: Mapped[Date] = mapped_column(Date)
    narration: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="posted")
    source: Mapped[str | None] = mapped_column(String(50))  # invoice/payment/grn/expense/manual
    source_ref: Mapped[str | None] = mapped_column(String(100))
    lines: Mapped[list["JournalLine"]] = relationship(back_populates="entry", cascade="all, delete-orphan")


class JournalLine(Base):
    __tablename__ = "journal_lines"
    id: Mapped[int] = mapped_column(primary_key=True)
    journal_entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("chart_of_accounts.id"))
    debit: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    credit: Mapped[Numeric] = mapped_column(Numeric(18, 2), default=0)
    entry: Mapped[JournalEntry] = relationship(back_populates="lines")


class DocumentSequence(Base):
    """Concurrency-safe document numbering."""
    __tablename__ = "document_sequences"
    id: Mapped[int] = mapped_column(primary_key=True)
    doc_type: Mapped[str] = mapped_column(String(30), unique=True)  # LPO/ORD/COL/INV/CP/PO/GRN...
    prefix: Mapped[str] = mapped_column(String(20))
    current_value: Mapped[int] = mapped_column(Integer, default=0)