"""Local-first persistence. SQLite is easy to replace with PostgreSQL later."""
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("ATLAS_DB_PATH", str(Path(__file__).resolve().parents[2] / "data" / "atlas.sqlite3")))


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=5000")
    connection.execute("PRAGMA journal_mode=WAL")
    return connection


def init_db() -> None:
    with connect() as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS analyses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target TEXT NOT NULL,
            kind TEXT NOT NULL,
            scanned_at TEXT NOT NULL,
            payload TEXT NOT NULL
        )""")
        conn.execute("CREATE INDEX IF NOT EXISTS ix_analyses_target ON analyses(target)")


def save(result: dict[str, Any]) -> dict[str, Any]:
    with connect() as conn:
        cursor = conn.execute(
            "INSERT INTO analyses (target, kind, scanned_at, payload) VALUES (?, ?, ?, ?)",
            (result["target"], result["kind"], result["scanned_at"], json.dumps(result, ensure_ascii=False)),
        )
        row_id = cursor.lastrowid
    return {**result, "id": row_id}


def history(query: str = "", limit: int = 40) -> list[dict[str, Any]]:
    pattern = "%" + query.replace("%", r"\%").replace("_", r"\_") + "%"
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, target, kind, scanned_at, payload FROM analyses "
            "WHERE target LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?",
            (pattern, limit),
        ).fetchall()
    return [{"id": row["id"], "target": row["target"], "kind": row["kind"],
             "scanned_at": row["scanned_at"], "summary": json.loads(row["payload"])["summary"]}
            for row in rows]


def get_one(row_id: int) -> dict[str, Any] | None:
    with connect() as conn:
        row = conn.execute("SELECT id, payload FROM analyses WHERE id = ?", (row_id,)).fetchone()
    return {**json.loads(row["payload"]), "id": row["id"]} if row else None


def statistics() -> dict[str, Any]:
    with connect() as conn:
        totals = conn.execute("SELECT COUNT(*) AS total, COUNT(DISTINCT target) AS targets FROM analyses").fetchone()
        last = conn.execute("SELECT id, target, kind, scanned_at FROM analyses ORDER BY id DESC LIMIT 6").fetchall()
        daily = conn.execute(
            "SELECT substr(scanned_at, 1, 10) AS day, COUNT(*) AS count "
            "FROM analyses GROUP BY substr(scanned_at, 1, 10) ORDER BY day DESC LIMIT 7"
        ).fetchall()
        domains = conn.execute("SELECT COUNT(*) AS value FROM analyses WHERE kind='domain'").fetchone()["value"]
    return {"total_analyses": totals["total"], "unique_targets": totals["targets"],
            "domain_analyses": domains, "ip_analyses": totals["total"] - domains,
            "recent": [dict(row) for row in last], "daily": list(reversed([dict(row) for row in daily])),
            "updated_at": datetime.now(timezone.utc).isoformat()}
