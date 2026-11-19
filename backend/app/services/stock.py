from sqlalchemy import select, func
from sqlalchemy.orm import Session
from fastapi import HTTPException
from app.models.business import StockBatch, StockMovement


def available_stock(db: Session, product_id: int, warehouse_id: int | None = None) -> int:
    q = select(func.coalesce(func.sum(StockBatch.qty_on_hand - StockBatch.qty_reserved - StockBatch.qty_damaged), 0)).where(
        StockBatch.product_id == product_id
    )
    if warehouse_id:
        q = q.where(StockBatch.warehouse_id == warehouse_id)
    return int(db.execute(q).scalar_one())


def _locked_batches(db: Session, product_id: int, warehouse_id: int):
    return db.execute(
        select(StockBatch)
        .where(StockBatch.product_id == product_id, StockBatch.warehouse_id == warehouse_id)
        .order_by(StockBatch.id)
        .with_for_update()
    ).scalars().all()


def issue_stock(db: Session, product_id: int, warehouse_id: int, quantity: int,
                reference: str, user_id: int | None, notes: str | None = None) -> None:
    """FIFO issue across batches. Raises 409 if insufficient. Caller commits."""
    if quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be positive")
    remaining = quantity
    for batch in _locked_batches(db, product_id, warehouse_id):
        free = batch.qty_on_hand - batch.qty_reserved - batch.qty_damaged
        if free <= 0:
            continue
        take = min(free, remaining)
        batch.qty_on_hand -= take
        remaining -= take
        if remaining == 0:
            break

    if remaining > 0:
        raise HTTPException(status_code=409, detail=f"Insufficient stock for product {product_id}")

    db.add(StockMovement(
        product_id=product_id, warehouse_id=warehouse_id,
        movement_type="issue", quantity=-quantity,
        reference=reference, notes=notes, user_id=user_id,
    ))


def receive_stock(db: Session, product_id: int, warehouse_id: int, quantity: int,
                  batch_no: str | None, expiry_date, reference: str | None,
                  user_id: int | None, notes: str | None = None) -> None:
    if quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be positive")
    batch = StockBatch(
        product_id=product_id, warehouse_id=warehouse_id,
        batch_no=batch_no, expiry_date=expiry_date, qty_on_hand=quantity,
    )
    db.add(batch)
    db.add(StockMovement(
        product_id=product_id, warehouse_id=warehouse_id,
        movement_type="receive", quantity=quantity,
        reference=reference, notes=notes, user_id=user_id,
    ))


def adjust_stock(db: Session, product_id: int, warehouse_id: int, delta: int,
                 reference: str | None, user_id: int | None, notes: str | None = None) -> None:
    """Manual correction. delta > 0 adds a batch, delta < 0 removes FIFO. Caller commits."""
    if delta == 0:
        raise HTTPException(status_code=422, detail="Adjustment cannot be zero")
    if delta > 0:
        db.add(StockBatch(product_id=product_id, warehouse_id=warehouse_id,
                          batch_no="ADJ", qty_on_hand=delta))
    else:
        remaining = -delta
        for batch in _locked_batches(db, product_id, warehouse_id):
            free = batch.qty_on_hand - batch.qty_reserved - batch.qty_damaged
            if free <= 0:
                continue
            take = min(free, remaining)
            batch.qty_on_hand -= take
            remaining -= take
            if remaining == 0:
                break
        if remaining > 0:
            raise HTTPException(status_code=409, detail="Not enough free stock to remove that quantity")
    db.add(StockMovement(
        product_id=product_id, warehouse_id=warehouse_id,
        movement_type="adjust", quantity=delta,
        reference=reference, notes=notes, user_id=user_id,
    ))


def damage_stock(db: Session, product_id: int, warehouse_id: int, quantity: int,
                 reference: str | None, user_id: int | None, notes: str | None = None) -> None:
    """Mark free units as damaged: they leave 'available' but stay on the books. Caller commits."""
    if quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be positive")
    remaining = quantity
    for batch in _locked_batches(db, product_id, warehouse_id):
        free = batch.qty_on_hand - batch.qty_reserved - batch.qty_damaged
        if free <= 0:
            continue
        take = min(free, remaining)
        batch.qty_damaged += take
        remaining -= take
        if remaining == 0:
            break
    if remaining > 0:
        raise HTTPException(status_code=409, detail="Not enough free stock to mark as damaged")
    db.add(StockMovement(
        product_id=product_id, warehouse_id=warehouse_id,
        movement_type="damage", quantity=-quantity,
        reference=reference, notes=notes, user_id=user_id,
    ))