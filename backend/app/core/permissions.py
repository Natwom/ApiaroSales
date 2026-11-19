ALL_PERMISSIONS = [
    "organization.create", "organization.update",
    "worker.create", "worker.authorize",
    "lpo.create", "lpo.approve", "lpo.amend",
    "order.create", "order.approve",
    "inventory.receive", "inventory.issue", "inventory.adjust",
    "collection.issue",
    "delivery.confirm",
    "invoice.create", "invoice.approve",
    "payment.record", "payment.verify", "payment.reverse",
    "expense.create",
    "report.export", "user.manage",
]

ROLE_PERMISSIONS = {
    "Super Administrator": ALL_PERMISSIONS,
    "General Manager": [p for p in ALL_PERMISSIONS if p != "user.manage"],
    "Accountant": ["invoice.create", "invoice.approve", "payment.record",
                   "payment.verify", "payment.reverse", "expense.create", "report.export"],
    "Procurement Officer": ["inventory.receive", "report.export"],
    "Storekeeper": ["inventory.receive", "inventory.issue", "inventory.adjust", "collection.issue"],
    "Supply Attendant": ["collection.issue"],
    "Delivery Officer": ["delivery.confirm"],
    "Auditor": ["report.export"],
}