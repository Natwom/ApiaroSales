from pydantic import BaseModel
from typing import Optional
from decimal import Decimal


class ProductIn(BaseModel):
    name: str
    sku: str
    barcode: Optional[str] = None
    category_id: Optional[int] = None
    description: Optional[str] = None
    unit: str = "pcs"
    purchase_price: Decimal = Decimal("0")
    selling_price: Decimal = Decimal("0")
    reorder_level: int = 0


class ProductOut(ProductIn):
    id: int
    status: str

    model_config = {"from_attributes": True}


class ReceiveStockIn(BaseModel):
    product_id: int
    warehouse_id: int
    quantity: int
    batch_no: Optional[str] = None
    expiry_date: Optional[str] = None
    reference: Optional[str] = None
    notes: Optional[str] = None