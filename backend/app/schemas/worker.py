from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import date


class WorkerIn(BaseModel):
    organization_id: int
    full_name: str
    employee_no: str
    department: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    collection_authorized: bool = False
    auth_start_date: Optional[date] = None
    auth_expiry_date: Optional[date] = None
    notes: Optional[str] = None


class WorkerOut(WorkerIn):
    id: int
    employment_status: str

    model_config = {"from_attributes": True}