import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"  # tests only

from app.main import app          # noqa: E402
from app.database.session import Base, get_db   # noqa: E402
import app.models  # noqa: E402, F401


@pytest.fixture()
def client():
    engine = create_engine("sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    TestingSession = sessionmaker(bind=engine)
    Base.metadata.create_all(engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db

    # Seed RBAC + chart of accounts + admin user
    db = TestingSession()
    from app.api.v1.auth import seed_rbac, seed_super_admin
    from app.models.finance import Account, Warehouse
    from decimal import Decimal

    seed_rbac(db)
    seed_super_admin(db, "admin@test.com", "Passw0rd!", "Admin")
    for code, name, typ in [
        ("1000", "Cash & Bank", "asset"),
        ("1100", "Accounts Receivable", "asset"),
        ("2000", "Accounts Payable", "liability"),
        ("2200", "Tax Payable", "liability"),
        ("3000", "Equity", "equity"),
        ("4000", "Sales Revenue", "revenue"),
        ("5000", "Cost of Goods Sold", "expense"),
    ]:
        db.add(Account(code=code, name=name, account_type=typ))
    db.add(Warehouse(name="Main Warehouse", location="Nairobi"))
    db.commit()
    db.close()

    with TestClient(app) as c:
        yield c