from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.models.business import Product, Warehouse, StockBatch, StockMovement
from app.schemas.catalog import ProductIn, ProductOut, ReceiveStockIn
from app.api.v1.deps import require_permission
from app.services import stock as stock_service
from app.services.audit import log as audit_log

router = APIRouter(prefix="/products", tags=["products"])


class WarehouseIn(BaseModel):
    name: str
    location: str | None = None


class AdjustStockIn(BaseModel):
    product_id: int
    warehouse_id: int
    kind: Literal["add", "remove", "damage"]
    quantity: int
    reason: str


@router.get("", response_model=list[ProductOut])
def list_products(search: str | None = None, db: Session = Depends(get_db),
                  user=Depends(require_permission("inventory.receive"))):
    q = select(Product).order_by(Product.name)
    if search:
        q = q.where(Product.name.ilike(f"%{search}%"))
    return db.execute(q).scalars().all()


@router.post("", response_model=ProductOut, status_code=201)
def create_product(payload: ProductIn, db: Session = Depends(get_db),
                   user=Depends(require_permission("inventory.adjust"))):
    dup = db.execute(select(Product).where(Product.sku == payload.sku)).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "SKU already exists")
    product = Product(**payload.model_dump())
    db.add(product)
    db.flush()
    audit_log(db, user.id, "create", "products", product.sku, new=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(product)
    return product


@router.get("/warehouses")
def list_warehouses(db: Session = Depends(get_db),
                    user=Depends(require_permission("inventory.receive"))):
    rows = db.execute(select(Warehouse).order_by(Warehouse.id)).scalars().all()
    return [{"id": w.id, "name": w.name, "location": w.location} for w in rows]


@router.post("/warehouses", status_code=201)
def create_warehouse(payload: WarehouseIn, db: Session = Depends(get_db),
                     user=Depends(require_permission("inventory.adjust"))):
    dup = db.execute(select(Warehouse).where(Warehouse.name == payload.name)).scalar_one_or_none()
    if dup:
        raise HTTPException(409, "Warehouse name already exists")
    w = Warehouse(name=payload.name, location=payload.location)
    db.add(w)
    db.flush()
    audit_log(db, user.id, "create", "warehouses", w.name, new=payload.model_dump())
    db.commit()
    db.refresh(w)
    return {"id": w.id, "name": w.name, "location": w.location}


@router.get("/stock-levels")
def stock_levels(db: Session = Depends(get_db),
                 user=Depends(require_permission("inventory.receive"))):
    warehouses = {w.id: w.name for w in db.execute(select(Warehouse)).scalars().all()}
    products = db.execute(select(Product).order_by(Product.name)).scalars().all()

    per_wh: dict[int, list[dict]] = {}
    for pid, wid, on_hand, reserved, damaged in db.execute(
        select(StockBatch.product_id, StockBatch.warehouse_id,
               func.coalesce(func.sum(StockBatch.qty_on_hand), 0),
               func.coalesce(func.sum(StockBatch.qty_reserved), 0),
               func.coalesce(func.sum(StockBatch.qty_damaged), 0))
        .group_by(StockBatch.product_id, StockBatch.warehouse_id)
    ).all():
        per_wh.setdefault(pid, []).append({
            "warehouse_id": wid, "warehouse": warehouses.get(wid, f"#{wid}"),
            "on_hand": int(on_hand), "damaged": int(damaged),
            "available": int(on_hand) - int(reserved) - int(damaged),
        })

    moved: dict[int, dict[str, int]] = {}
    for pid, mtype, qty in db.execute(
        select(StockMovement.product_id, StockMovement.movement_type,
               func.coalesce(func.sum(func.abs(StockMovement.quantity)), 0))
        .group_by(StockMovement.product_id, StockMovement.movement_type)
    ).all():
        moved.setdefault(pid, {})[mtype] = int(qty)

    result = []
    for p in products:
        wh = per_wh.get(p.id, [])
        available = sum(x["available"] for x in wh)
        m = moved.get(p.id, {})
        result.append({
            "product_id": p.id, "name": p.name, "sku": p.sku, "unit": p.unit,
            "purchase_price": str(p.purchase_price), "selling_price": str(p.selling_price),
            "received": m.get("receive", 0),
            "collected": m.get("issue", 0),
            "damaged": sum(x["damaged"] for x in wh),
            "on_hand": sum(x["on_hand"] for x in wh),
            "available": available,
            "reorder_level": p.reorder_level,
            "low_stock": available <= p.reorder_level,
            "by_warehouse": wh,
        })
    return result


@router.get("/stock-trend")
def stock_trend(days: int = 14, db: Session = Depends(get_db),
                user=Depends(require_permission("inventory.receive"))):
    days = max(1, min(days, 90))
    since = date.today() - timedelta(days=days - 1)
    day = func.date(StockMovement.created_at)
    rows = db.execute(
        select(day, StockMovement.movement_type,
               func.coalesce(func.sum(func.abs(StockMovement.quantity)), 0))
        .where(day >= since, StockMovement.movement_type.in_(["receive", "issue"]))
        .group_by(day, StockMovement.movement_type)
    ).all()
    table: dict[str, dict[str, int]] = {}
    for d, mtype, qty in rows:
        table.setdefault(str(d), {})[mtype] = int(qty)
    out = []
    for i in range(days):
        d = (since + timedelta(days=i)).isoformat()
        out.append({"date": d,
                    "received": table.get(d, {}).get("receive", 0),
                    "collected": table.get(d, {}).get("issue", 0)})
    return out


@router.get("/stock-movements")
def stock_movements(product_id: int | None = None, limit: int = 200,
                    db: Session = Depends(get_db),
                    user=Depends(require_permission("inventory.receive"))):
    q = (
        select(StockMovement, Product.name, Warehouse.name)
        .join(Product, Product.id == StockMovement.product_id)
        .join(Warehouse, Warehouse.id == StockMovement.warehouse_id)
        .order_by(StockMovement.id.desc())
        .limit(max(1, min(limit, 500)))
    )
    if product_id:
        q = q.where(StockMovement.product_id == product_id)
    return [{
        "id": m.id, "product_id": m.product_id, "product": pname,
        "warehouse_id": m.warehouse_id, "warehouse": wname,
        "movement_type": m.movement_type, "quantity": m.quantity,
        "reference": m.reference, "notes": m.notes, "created_at": m.created_at,
    } for m, pname, wname in db.execute(q).all()]


@router.post("/receive", status_code=201)
def receive_goods(payload: ReceiveStockIn, db: Session = Depends(get_db),
                  user=Depends(require_permission("inventory.receive"))):
    if payload.quantity <= 0:
        raise HTTPException(422, "Quantity must be positive")
    stock_service.receive_stock(
        db, payload.product_id, payload.warehouse_id, payload.quantity,
        payload.batch_no, payload.expiry_date, payload.reference, user.id, payload.notes,
    )
    audit_log(db, user.id, "receive", "inventory",
              payload.reference, new=payload.model_dump())
    db.commit()
    return {"status": "received"}


@router.post("/adjust", status_code=201)
def adjust_goods(payload: AdjustStockIn, db: Session = Depends(get_db),
                 user=Depends(require_permission("inventory.adjust"))):
    if payload.quantity <= 0:
        raise HTTPException(422, "Quantity must be positive")
    if not payload.reason.strip():
        raise HTTPException(422, "A reason is required")
    if db.get(Product, payload.product_id) is None:
        raise HTTPException(404, "Product not found")
    if db.get(Warehouse, payload.warehouse_id) is None:
        raise HTTPException(404, "Warehouse not found")

    ref = f"ADJ-{payload.kind.upper()}"
    reason = payload.reason.strip()
    if payload.kind == "add":
        stock_service.adjust_stock(db, payload.product_id, payload.warehouse_id,
                                   payload.quantity, ref, user.id, reason)
    elif payload.kind == "remove":
        stock_service.adjust_stock(db, payload.product_id, payload.warehouse_id,
                                   -payload.quantity, ref, user.id, reason)
    else:
        stock_service.damage_stock(db, payload.product_id, payload.warehouse_id,
                                   payload.quantity, ref, user.id, reason)
    audit_log(db, user.id, "adjust", "inventory", ref,
              new=payload.model_dump(), reason=reason)
    db.commit()
    return {"status": "ok"}