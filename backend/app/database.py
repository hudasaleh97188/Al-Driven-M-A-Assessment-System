"""
database.py
-----------
Lightweight SQLite persistence layer with just **2 tables**:
  - companies       – master record per company
  - analysis_runs   – one row per analysis (stores full JSON result)

Design rationale: the LLM output is write-once / read-many and the
frontend consumes the full JSON blob in a single GET call.  Normalizing
into 17 tables adds complexity with zero query benefit.
"""

import json
import sqlite3
from datetime import datetime
from typing import Optional, Dict, List

from loguru import logger
from app.config import DB_PATH

# ---------------------------------------------------------------------------
# DDL
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analysis_runs (
    id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    company_id    INTEGER  NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    run_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
    status        TEXT     NOT NULL DEFAULT 'pending'
                           CHECK(status IN ('pending','running','completed','failed')),
    currency      TEXT,
    result_json   TEXT,
    error_message TEXT
);

CREATE TABLE IF NOT EXISTS peer_ratings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    run_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    result_json TEXT,
    UNIQUE(company_id)
);
"""

# ---------------------------------------------------------------------------
# Connection helper
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    """Create tables if they don't already exist."""
    with _get_conn() as conn:
        conn.executescript(SCHEMA_SQL)
    logger.info("Database initialised at {}", str(DB_PATH))


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------

def upsert_company(name: str) -> int:
    """Insert or get the company id (case-insensitive match on name)."""
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO companies (name) VALUES (?) "
            "ON CONFLICT(name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP",
            (name,),
        )
        row = conn.execute(
            "SELECT id FROM companies WHERE name = ?", (name,)
        ).fetchone()
        return row["id"]


def create_run(company_id: int, status: str = "pending") -> int:
    """Create a new analysis_run and return its id."""
    with _get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO analysis_runs (company_id, status) VALUES (?, ?)",
            (company_id, status),
        )
        run_id = cursor.lastrowid
        conn.commit()
    logger.info("[DB] Created analysis_run id={} for company_id={}", run_id, company_id)
    return run_id


def update_run(run_id: int, *, status: str, result: Optional[dict] = None,
               currency: Optional[str] = None, error: Optional[str] = None) -> None:
    """Update an analysis_run with its final result or error."""
    with _get_conn() as conn:
        conn.execute(
            """UPDATE analysis_runs
               SET status = ?, result_json = ?, currency = ?, error_message = ?,
                   run_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (
                status,
                json.dumps(result) if result else None,
                currency,
                error,
                run_id,
            ),
        )
        conn.commit()
    logger.info("[DB] Updated run_id={} → status={}", run_id, status)


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def get_latest_analysis(company_name: str) -> Optional[Dict]:
    """Return the most recent *completed* analysis for a company, or None."""
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT ar.result_json, ar.currency, ar.run_at
               FROM analysis_runs ar
               JOIN companies c ON c.id = ar.company_id
               WHERE c.name = ? AND ar.status = 'completed'
               ORDER BY ar.run_at DESC
               LIMIT 1""",
            (company_name,),
        ).fetchone()

    if not row or not row["result_json"]:
        logger.warning("[DB] No completed analysis found for '{}'", company_name)
        return None

    data = json.loads(row["result_json"])
    # Ensure top-level metadata is consistent
    data["company_name"] = company_name
    data["currency"] = row["currency"] or data.get("currency", "USD")
    logger.info("[DB] Returning analysis for '{}' (run_at={})", company_name, row["run_at"])
    return data


def get_all_analyses() -> List[Dict]:
    """Return a list of all companies with their latest analysis timestamp."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT c.name AS company_name,
                      MAX(ar.run_at) AS analyzed_at
               FROM companies c
               LEFT JOIN analysis_runs ar
                      ON ar.company_id = c.id AND ar.status = 'completed'
               GROUP BY c.id
               ORDER BY analyzed_at DESC"""
        ).fetchall()
    return [{"company_name": r["company_name"], "analyzed_at": r["analyzed_at"]} for r in rows]


def save_peer_rating(company_name: str, result: dict) -> None:
    """Upsert peer rating result for a company."""
    company_id = upsert_company(company_name)
    with _get_conn() as conn:
        conn.execute(
            """INSERT INTO peer_ratings (company_id, result_json)
               VALUES (?, ?)
               ON CONFLICT(company_id) DO UPDATE SET
                   result_json = excluded.result_json,
                   run_at = CURRENT_TIMESTAMP""",
            (company_id, json.dumps(result)),
        )
        conn.commit()
    logger.info("[DB] Saved peer rating for '{}'", company_name)


def get_peer_rating(company_name: str) -> Optional[Dict]:
    """Return the peer rating for a company, or None."""
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT pr.result_json, pr.run_at
               FROM peer_ratings pr
               JOIN companies c ON c.id = pr.company_id
               WHERE c.name = ?
               ORDER BY pr.run_at DESC
               LIMIT 1""",
            (company_name,),
        ).fetchone()
    if not row or not row["result_json"]:
        return None
    return json.loads(row["result_json"])


def delete_company(company_name: str) -> bool:
    """Delete a company and all its analysis runs (CASCADE). Returns True if found."""
    with _get_conn() as conn:
        cursor = conn.execute(
            "DELETE FROM companies WHERE name = ?", (company_name,)
        )
        conn.commit()
        deleted = cursor.rowcount > 0
    if deleted:
        logger.info("[DB] Deleted company '{}' and all runs", company_name)
    else:
        logger.warning("[DB] Company '{}' not found for deletion", company_name)
    return deleted
