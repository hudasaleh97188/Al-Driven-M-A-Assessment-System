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

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('viewer','reviewer','admin')),
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO users (id, username, password_hash, role) 
VALUES (1, 'admin', 'mock_hash_admin', 'admin'),
       (2, 'reviewer', 'mock_hash_reviewer', 'reviewer'),
       (3, 'viewer', 'mock_hash_viewer', 'viewer');

CREATE TABLE IF NOT EXISTS companies (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    industry    TEXT,
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
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    peer_company_name TEXT,
    run_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    result_json       TEXT
);

CREATE TABLE IF NOT EXISTS financial_metrics (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_run_id   INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    category          TEXT,
    metric_name       TEXT NOT NULL,
    is_calculated     BOOLEAN NOT NULL DEFAULT 0,
    reported_currency TEXT,
    value_reported    REAL,
    value_usd         REAL,
    year              INTEGER,
    confidence_score  REAL,
    explanation       TEXT
);

CREATE TABLE IF NOT EXISTS financial_metrics_approved (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_run_id         INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    metric_id               INTEGER NOT NULL REFERENCES financial_metrics(id) ON DELETE CASCADE,
    value_usd_approved      REAL,
    value_reported_approved REAL,
    reviewed_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at             DATETIME DEFAULT CURRENT_TIMESTAMP
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
        conn.commit()
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
        if result:
            # Inject company_id into result_json so it's persisted
            row = conn.execute("SELECT company_id FROM analysis_runs WHERE id = ?", (run_id,)).fetchone()
            if row:
                result["company_id"] = row["company_id"]

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
        
        # Save raw metrics if completed
        if result and status == "completed":
            financial_data = result.get("financial_data", [])
            _save_raw_financial_metrics_inline(conn, run_id, financial_data, currency)
            
        conn.commit()
    logger.info("[DB] Updated run_id={} → status={}", run_id, status)

def _save_raw_financial_metrics_inline(conn, run_id, financial_data, currency):
    conn.execute("DELETE FROM financial_metrics WHERE analysis_run_id = ?", (run_id,))
    for block in financial_data:
        year = block.get("year")
        if not year:
            continue
        fh = block.get("financial_health", {})
        for metric, value in fh.items():
            if value is None or not isinstance(value, (int, float)):
                continue
            is_calc = 1 if metric.endswith("_percent") or metric in ["depositors_vs_borrowers_ratio"] else 0
            cat = "Calculated" if is_calc else "Foundational"
            conn.execute(
                """INSERT INTO financial_metrics
                   (analysis_run_id, category, metric_name, is_calculated, reported_currency, value_reported, year)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (run_id, cat, metric, is_calc, currency, float(value), year)
            )


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

def get_latest_analysis(company_name: str) -> Optional[Dict]:
    """Return the most recent *completed* analysis for a company, or None."""
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT c.id AS company_id, ar.id AS run_id, ar.result_json, ar.currency, ar.run_at
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
    data["company_id"] = row["company_id"]
    data["company_name"] = company_name
    data["currency"] = row["currency"] or data.get("currency", "USD")
    
    # Overlay approved metrics
    run_id = row["run_id"]
    overrides = get_approved_financial_metrics(run_id)
    if overrides and "financial_data" in data:
        for year_block in data["financial_data"]:
            year = year_block.get("year")
            if year in overrides:
                if "financial_health" not in year_block:
                    year_block["financial_health"] = {}
                for k, v in overrides[year].items():
                    year_block["financial_health"][k] = v

    data["run_id"] = run_id
    logger.info("[DB] Returning analysis for '{}' (company_id={}, run_id={}, run_at={})", company_name, row["company_id"], run_id, row["run_at"])
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
    """Insert peer rating result for a company."""
    with _get_conn() as conn:
        row = conn.execute("SELECT id FROM companies WHERE name = ?", (company_name,)).fetchone()
        if not row:
            logger.error("[DB] save_peer_rating failed: Company '{}' not found in companies table", company_name)
            return

        company_id = row["id"]
        result["company_id"] = company_id
        
        conn.execute(
            """INSERT INTO peer_ratings (company_id, result_json)
               VALUES (?, ?)""",
            (company_id, json.dumps(result)),
        )
        conn.commit()
    logger.info("[DB] Saved peer rating for '{}'", company_name)


def get_peer_rating(company_name: str) -> Optional[Dict]:
    """Return the peer rating for a company, or None."""
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT c.id AS company_id, pr.result_json, pr.run_at
               FROM peer_ratings pr
               JOIN companies c ON c.id = pr.company_id
               WHERE c.name = ?
               ORDER BY pr.run_at DESC
               LIMIT 1""",
            (company_name,),
        ).fetchone()
    if not row or not row["result_json"]:
        return None
        
    data = json.loads(row["result_json"])
    data["company_id"] = row["company_id"]
    return data


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


def get_approved_financial_metrics(run_id: int) -> dict:
    """Returns {year: {metric_name: value}} for a given analysis run."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT fm.year, fm.metric_name, fma.value_reported_approved
               FROM financial_metrics_approved fma
               JOIN financial_metrics fm ON fma.metric_id = fm.id
               WHERE fma.analysis_run_id = ?""",
            (run_id,)
        ).fetchall()
        
    out = {}
    for r in rows:
        y = r["year"]
        if y not in out:
            out[y] = {}
        out[y][r["metric_name"]] = r["value_reported_approved"]
    return out


def update_approved_financial_metric(run_id: int, year: int, metric_name: str, value: float, username: str = "reviewer") -> bool:
    """Inserts or updates a single validated financial metric override."""
    with _get_conn() as conn:
        user_row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        user_id = user_row["id"] if user_row else None
        
        metric_row = conn.execute(
            "SELECT id FROM financial_metrics WHERE analysis_run_id = ? AND year = ? AND metric_name = ?",
            (run_id, year, metric_name)
        ).fetchone()
        
        if not metric_row:
            cursor = conn.execute(
                """INSERT INTO financial_metrics 
                 (analysis_run_id, category, metric_name, is_calculated, year)
                 VALUES (?, 'Foundational', ?, 0, ?)""", (run_id, metric_name, year)
            )
            metric_id = cursor.lastrowid
        else:
            metric_id = metric_row["id"]
            
        conn.execute("DELETE FROM financial_metrics_approved WHERE metric_id = ?", (metric_id,))
        if value is not None and value != '':
            conn.execute(
                """INSERT INTO financial_metrics_approved
                   (analysis_run_id, metric_id, value_reported_approved, reviewed_by, reviewed_at)
                   VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)""",
                (run_id, metric_id, float(value), user_id)
            )
        conn.commit()
    logger.info("[DB] User {} approved metric {}={} for run {}, year {}", username, metric_name, value, run_id, year)
    return True

