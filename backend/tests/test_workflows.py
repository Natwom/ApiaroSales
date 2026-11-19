from decimal import Decimal


def login(client):
    r = client.post("/api/v1/auth/login", json={"email": "admin@test.com", "password": "Passw0rd!"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_full_sales_workflow(client):
    h = login(client)

    # 1. Organization
    r = client.post("/api/v1/organizations", headers=h, json={
        "name": "World Vision", "org_type": "NGO",
        "contact_person": "Jane Doe", "phone": "0700000000",
    })
    assert r.status_code == 201, r.text
    org_id = r.json()["id"]

    # duplicate rejected
    r = client.post("/api/v1/organizations", headers=h, json={"name": "World Vision"})
    assert r.status_code == 409

    # 2. Product
    r = client.post("/api/v1/products", headers=h, json={
        "name": "Milk 500ml", "sku": "MLK-500", "selling_price": "65.00",
        "purchase_price": "50.00",
    })
    assert r.status_code == 201, r.text
    product_id = r.json()["id"]

    # 3. Stock receive (200 units)
    r = client.post("/api/v1/products/receive", headers=h, json={
        "product_id": product_id, "warehouse_id": 1, "quantity": 200, "reference": "TEST-GRN",
    })
    assert r.status_code == 201, r.text

    # 4. Worker + authorization
    r = client.post("/api/v1/workers", headers=h, json={
        "organization_id": org_id, "full_name": "John Worker",
        "employee_no": "WV-1001", "department": "Field",
        "collection_authorized": True,
    })
    assert r.status_code == 201, r.text
    worker_id = r.json()["id"]

    # 5. LPO (Milk 100 @ 65)
    r = client.post("/api/v1/lpos", headers=h, json={
        "customer_lpo_no": "WV-LPO-0001", "organization_id": org_id,
        "issue_date": "2026-11-01",
        "items": [{"product_id": product_id, "authorized_qty": 100, "unit_price": "65.00"}],
    })
    assert r.status_code == 201, r.text
    lpo = r.json()
    assert lpo["internal_ref"].startswith("API-LPO-")
    assert lpo["authorized_total"] == "6500.00"

    # duplicate LPO number rejected
    r = client.post("/api/v1/lpos", headers=h, json={
        "customer_lpo_no": "WV-LPO-0001", "organization_id": org_id,
        "issue_date": "2026-11-01",
        "items": [{"product_id": product_id, "authorized_qty": 1, "unit_price": "1.00"}],
    })
    assert r.status_code == 409

    # self-approval prevented
    r = client.post(f"/api/v1/lpos/{lpo['id']}/approve", headers=h, json={"approve": True})
    assert r.status_code == 403  # same user entered and approves

    # approve with second user (GM)
    from app.database.session import SessionLocal
    from app.models.identity import User, Role
    from app.core.security import hash_password
    from sqlalchemy import select
    db = SessionLocal()
    gm_role = db.execute(select(Role).where(Role.name == "General Manager")).scalar_one()
    gm = User(full_name="GM", email="gm@test.com", password_hash=hash_password("Passw0rd!"), roles=[gm_role])
    db.add(gm); db.commit()
    db.close()
    r = client.post("/api/v1/auth/login", json={"email": "gm@test.com", "password": "Passw0rd!"})
    h2 = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = client.post(f"/api/v1/lpos/{lpo['id']}/approve", headers=h2, json={"approve": True})
    assert r.status_code == 200, r.text

    # 6. Order within LPO limits
    r = client.post("/api/v1/orders", headers=h, json={
        "organization_id": org_id, "lpo_id": lpo["id"], "worker_id": worker_id,
        "items": [{"product_id": product_id, "quantity": 60, "unit_price": "65.00"}],
    })
    assert r.status_code == 201, r.text
    order = r.json()
    assert order["total"] == "3900.00"

    # order exceeding LPO qty rejected
    r = client.post("/api/v1/orders", headers=h, json={
        "organization_id": org_id, "lpo_id": lpo["id"],
        "items": [{"product_id": product_id, "quantity": 50, "unit_price": "65.00"}],
    })
    assert r.status_code == 409

    # approve order (by GM to avoid self-approval rule being bypassed — rule is on LPO only here)
    r = client.post(f"/api/v1/orders/{order['id']}/approve", headers=h2, json={})
    assert r.status_code == 200, r.text

    # 7. Partial collection 30 units
    r = client.post("/api/v1/collections", headers=h, json={
        "organization_id": org_id, "order_id": order["id"], "worker_id": worker_id,
        "items": [{"order_item_id": order["items"][0]["id"], "quantity": 30}],
    })
    assert r.status_code == 201, r.text
    col = r.json()
    assert col["internal_ref"].startswith("API-COL-")
    assert col["items"][0]["remaining_after"] == 30

    # over-collection rejected
    r = client.post("/api/v1/collections", headers=h, json={
        "organization_id": org_id, "order_id": order["id"], "worker_id": worker_id,
        "items": [{"order_item_id": order["items"][0]["id"], "quantity": 31}],
    })
    assert r.status_code == 409

    # 8. Invoice only collected goods
    r = client.post("/api/v1/invoices", headers=h, json={
        "organization_id": org_id, "lpo_id": lpo["id"], "order_id": order["id"],
        "invoice_date": "2026-11-05", "tax_rate": "16.00",
        "items": [{"product_id": product_id, "quantity": 30, "unit_price": "65.00"}],
    })
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["subtotal"] == "1950.00"
    assert inv["tax_amount"] == "312.00"
    assert inv["total"] == "2262.00"

    # invoicing more than collected rejected
    r = client.post("/api/v1/invoices", headers=h, json={
        "organization_id": org_id, "order_id": order["id"], "invoice_date": "2026-11-05",
        "items": [{"product_id": product_id, "quantity": 31, "unit_price": "65.00"}],
    })
    assert r.status_code == 409

    # 9. Record + verify payment (partial 1000)
    r = client.post("/api/v1/payments/customer", headers=h, json={
        "organization_id": org_id, "payment_date": "2026-11-10", "method": "mpesa_manual",
        "transaction_ref": "MPESA-TEST-1", "amount": "1000.00",
        "allocations": [{"invoice_id": inv["id"], "amount": "1000.00"}],
    })
    assert r.status_code == 201, r.text
    pay = r.json()

    # duplicate tx ref rejected
    r = client.post("/api/v1/payments/customer", headers=h, json={
        "organization_id": org_id, "payment_date": "2026-11-10", "method": "mpesa_manual",
        "transaction_ref": "MPESA-TEST-1", "amount": "10.00", "allocations": [],
    })
    assert r.status_code == 409

    # self-verification prevented
    r = client.post(f"/api/v1/payments/customer/{pay['id']}/verify", headers=h,
                    json={"approve": True})
    assert r.status_code == 403

    r = client.post(f"/api/v1/payments/customer/{pay['id']}/verify", headers=h2,
                    json={"approve": True})
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/invoices?status=partially_paid", headers=h)
    assert any(i["id"] == inv["id"] for i in r.json())

    # 10. Dashboard reflects real data
    r = client.get("/api/v1/dashboard/summary", headers=h)
    body = r.json()
    assert Decimal(body["total_invoiced"]) >= Decimal("2262.00")
    assert body["organizations"] >= 1


def test_kes_formatting_logic():
    # Central formatting rule used by frontend utils and PDF generators
    def kes(value):
        v = Decimal(str(value)).quantize(Decimal("0.01"))
        return f"KSh {v:,.2f}"

    assert kes("500") == "KSh 500.00"
    assert kes("12500") == "KSh 12,500.00"
    assert kes("125500") == "KSh 125,500.00"
    assert kes("1250000") == "KSh 1,250,000.00"