from fastapi import APIRouter
from app.api.v1 import (
    auth, organizations, workers, products, lpos, orders, collections, invoices, payments,
    dashboard, suppliers, procurement, deliveries, payables, expenses, accounting, users, audit,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(organizations.router)
api_router.include_router(workers.router)
api_router.include_router(products.router)
api_router.include_router(suppliers.router)
api_router.include_router(procurement.router)
api_router.include_router(lpos.router)
api_router.include_router(orders.router)
api_router.include_router(collections.router)
api_router.include_router(deliveries.router)
api_router.include_router(invoices.router)
api_router.include_router(payments.router)
api_router.include_router(payables.router)
api_router.include_router(expenses.router)
api_router.include_router(accounting.router)
api_router.include_router(audit.router)
api_router.include_router(dashboard.router)