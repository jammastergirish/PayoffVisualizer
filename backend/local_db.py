"""Local SQLite cache for data we don't want to refetch from upstream APIs.

This is a general-purpose store. Each domain registers its own migrations
(see `sec_filings_db.py` etc.) so this module stays domain-agnostic.

Conventions:
- One DB file at backend/data/cache.db (gitignored).
- WAL mode for concurrent reads.
- Migrations live as a list of (version, statements) tuples — versions are
  monotonically increasing integers. Adding a new table = bump the version
  and append the migration.
- Callers open a connection via `get_conn()` and close it; for FastAPI use
  one connection per request.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path
from typing import Callable, Iterable

_DB_PATH = Path(__file__).resolve().parent / "data" / "cache.db"
_init_lock = threading.Lock()
_initialized = False


# Registered migrations. Each domain module imports this list and appends
# its migrations at import time. We keep them in a single sorted list so
# version numbers can't collide.
_MIGRATIONS: list[tuple[int, str, str]] = []
# (version, label, sql) — sql can contain multiple statements separated by ';'.


def register_migration(version: int, label: str, sql: str) -> None:
    """Append a migration. Call at module import time."""
    _MIGRATIONS.append((version, label, sql))


def get_db_path() -> Path:
    return _DB_PATH


def _ensure_db_dir() -> None:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def get_conn() -> sqlite3.Connection:
    """Open a new connection. Caller is responsible for closing.

    Returns rows as dict-like sqlite3.Row. Foreign keys enabled. WAL mode
    is set once at first init.
    """
    _ensure_initialized()
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _ensure_initialized() -> None:
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        _ensure_db_dir()
        conn = sqlite3.connect(str(_DB_PATH))
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS meta_schema_version (
                    version INTEGER PRIMARY KEY
                )
                """
            )
            _apply_migrations(conn)
            conn.commit()
        finally:
            conn.close()
        _initialized = True


def _apply_migrations(conn: sqlite3.Connection) -> None:
    row = conn.execute("SELECT MAX(version) AS v FROM meta_schema_version").fetchone()
    current = (row[0] if row and row[0] is not None else 0)
    pending = sorted([m for m in _MIGRATIONS if m[0] > current], key=lambda m: m[0])
    for version, label, sql in pending:
        print(f"[local_db] applying migration {version}: {label}")
        conn.executescript(sql)
        conn.execute("INSERT INTO meta_schema_version(version) VALUES (?)", (version,))


def with_conn(fn: Callable[[sqlite3.Connection], "object"]):
    """Helper: open a connection, run fn, commit + close."""
    conn = get_conn()
    try:
        out = fn(conn)
        conn.commit()
        return out
    finally:
        conn.close()


def executemany(conn: sqlite3.Connection, sql: str, rows: Iterable[tuple]) -> int:
    """Wrapper that returns affected-row count for caller logging."""
    cur = conn.executemany(sql, list(rows))
    return cur.rowcount


def db_stats() -> dict:
    """Light stats for /api/cache/db-stats (added later)."""
    info: dict = {"path": str(_DB_PATH), "exists": _DB_PATH.exists()}
    if not _DB_PATH.exists():
        return info
    info["size_bytes"] = _DB_PATH.stat().st_size
    conn = get_conn()
    try:
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        counts = {}
        for (name,) in [(r["name"],) for r in tables]:
            try:
                c = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
                counts[name] = c
            except Exception:
                counts[name] = None
        info["row_counts"] = counts
    finally:
        conn.close()
    return info
