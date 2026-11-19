from pydantic import BaseModel, EmailStr
from typing import Optional


class OrganizationIn(BaseModel):
    name: str
    org_type: str = "NGO"
    registration_no: Optional[str] = None
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    physical_address: Optional[str] = None
    billing_address: Optional[str] = None
    delivery_address: Optional[str] = None
    tax_info: Optional[str] = None
    notes: Optional[str] = None


class OrganizationOut(OrganizationIn):
    id: int
    status: str

    model_config = {"from_attributes": True}