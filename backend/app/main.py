import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.database.session import Base, engine, SessionLocal
from app.api.v1.router import api_router
from app.api.v1.auth import seed_rbac, seed_super_admin

# Ensure all models are registered on Base.metadata
import app.models  # noqa: F401


app = FastAPI(title="APIARO — Enterprise Business Management Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.on_event("startup")
def startup():
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    # Dev convenience: create tables + seed RBAC + super admin.
    # In production use Alembic migrations instead.
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_rbac(db)
        seed_super_admin(
            db,
            email=os.getenv("SUPER_ADMIN_EMAIL", "admin@apiaro.co.ke"),
            password=os.getenv("SUPER_ADMIN_PASSWORD", "ChangeMe!123"),
            full_name="APIARO Super Administrator",
        )
    finally:
        db.close()