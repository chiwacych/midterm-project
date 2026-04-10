import sqlalchemy
from sqlalchemy import create_engine, event, text as sa_text
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import QueuePool
import os
import random
from typing import Generator

from models import Base

# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://dfsuser:dfspassword@localhost:5432/dfs_metadata")
DATABASE_REPLICA1_URL = os.getenv("DATABASE_REPLICA1_URL", None)
DATABASE_REPLICA2_URL = os.getenv("DATABASE_REPLICA2_URL", None)

# Create primary engine with connection pooling
engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,  # Verify connections before using
    echo=False  # Set to True for SQL query logging
)

# Create replica engines if configured
replica_engines = []
if DATABASE_REPLICA1_URL:
    replica1_engine = create_engine(
        DATABASE_REPLICA1_URL,
        poolclass=QueuePool,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        echo=False
    )
    replica_engines.append(replica1_engine)

if DATABASE_REPLICA2_URL:
    replica2_engine = create_engine(
        DATABASE_REPLICA2_URL,
        poolclass=QueuePool,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        echo=False
    )
    replica_engines.append(replica2_engine)

# Create session factory for primary (write operations)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create session factory for replicas (read operations)
if replica_engines:
    # Round-robin load balancing for read replicas
    replica_session_makers = [
        sessionmaker(autocommit=False, autoflush=False, bind=replica_engine)
        for replica_engine in replica_engines
    ]
else:
    replica_session_makers = None


def _apply_migrations(conn) -> None:
    """Add columns introduced after initial schema creation. Safe to run repeatedly."""
    migrations = [
        # DICOM per-instance identifiers added for OHIF WADO lookup and slice ordering
        "ALTER TABLE file_metadata ADD COLUMN IF NOT EXISTS dicom_instance_uid VARCHAR(100)",
        "ALTER TABLE file_metadata ADD COLUMN IF NOT EXISTS dicom_instance_number INTEGER",
        "CREATE INDEX IF NOT EXISTS ix_file_metadata_dicom_instance_uid ON file_metadata (dicom_instance_uid)",
    ]
    for sql in migrations:
        try:
            conn.execute(sa_text(sql))
        except Exception as exc:
            print(f"Migration skipped ({sql!r}): {exc}")
    conn.commit()


def init_db():
    """Initialize database - create all tables"""
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully on primary!")

    with engine.connect() as conn:
        _apply_migrations(conn)
    print("Schema migrations applied.")

    # Wait for replication to catch up
    if replica_engines:
        import time
        print("Waiting for replicas to sync...")
        time.sleep(3)
        print(f"Replication configured with {len(replica_engines)} replica(s)")


def get_db() -> Generator[Session, None, None]:
    """
    Dependency to get database session for write operations (uses primary).
    Use in FastAPI endpoints with Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_read_db() -> Generator[Session, None, None]:
    """
    Dependency to get database session for read operations (uses replicas if available).
    Falls back to primary if no replicas configured.
    Use in FastAPI read-only endpoints with Depends(get_read_db)
    """
    if replica_session_makers:
        # Random load balancing across replicas
        session_maker = random.choice(replica_session_makers)
        db = session_maker()
    else:
        # Fall back to primary if no replicas
        db = SessionLocal()
    
    try:
        yield db
    finally:
        db.close()
