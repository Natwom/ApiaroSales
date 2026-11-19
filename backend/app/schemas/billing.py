from pydantic import BaseModel
from typing import Optional
from datetime import date
from decimal import Decimal


class InvoiceItemIn(BaseModel):
    product_id: int
    description: Optional[str] = None
    quantity: int
    unit_price: Decimal


class InvoiceIn(BaseModel):
    organization_id: int
    lpo_id: Optional[int] = None
    order_id: Optional[int] = None
    invoice_date: date
    due_date: Optional[date] = None
    tax_rate: Decimal = Decimal("0")
    items: list[InvoiceItemIn]


class PaymentAllocationIn(BaseModel):
    invoice_id: int
    amount: Decimal


class CustomerPaymentIn(BaseModel):
    organization_id: int
    payment_date: date
    method: str  # mpesa_manual / bank_transfer / cash / cheque / other
    transaction_ref: str
    amount: Decimal
    description: Optional[str] = None
    allocations: list[PaymentAllocationIn]


class VerifyPaymentIn(BaseModel):
    approve: bool = True
    reason: Optional[str] = None