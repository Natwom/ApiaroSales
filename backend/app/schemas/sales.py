from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import date
from decimal import Decimal


class LPOItemIn(BaseModel):
    product_id: int
    authorized_qty: int
    unit_price: Decimal

    @field_validator("authorized_qty")
    @classmethod
    def qty_positive(cls, v):
        if v <= 0:
            raise ValueError("Quantity must be positive")
        return v


class LPOIn(BaseModel):
    customer_lpo_no: str
    organization_id: int
    worker_id: int
    issue_date: date
    expiry_date: Optional[date] = None
    terms: Optional[str] = None
    items: list[LPOItemIn]

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("LPO must contain at least one item")
        return v


class LPOApproveIn(BaseModel):
    approve: bool = True
    reason: Optional[str] = None


class OrderItemIn(BaseModel):
    product_id: int
    quantity: int
    unit_price: Decimal


class OrderIn(BaseModel):
    organization_id: int
    lpo_id: Optional[int] = None
    worker_id: Optional[int] = None
    required_date: Optional[date] = None
    discount: Decimal = Decimal("0")
    tax_rate: Decimal = Decimal("0")
    items: list[OrderItemIn]


class CollectionItemIn(BaseModel):
    order_item_id: int
    quantity: int


class CollectionIn(BaseModel):
    organization_id: int
    order_id: int
    worker_id: int
    recipient_name: Optional[str] = None
    items: list[CollectionItemIn]

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("Collection must contain at least one item")
        return v