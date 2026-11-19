from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import settings

_connect_args = {}
# Neon's pooled connection (host contains "-pooler") runs through PgBouncer,
# which doesn't like psycopg's automatic prepared statements.
if "-pooler" in settings.DATABASE_URL:
    _connect_args["prepare_threshold"] = None

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,   # test a connection before using it (Neon pauses idle databases)
    pool_recycle=300,     # refresh connections every 5 minutes
    pool_size=5,
    max_overflow=5,
    connect_args=_connect_args,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()