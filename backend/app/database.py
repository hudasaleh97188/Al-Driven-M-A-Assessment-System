"""
database.py
-----------
SQLite persistence layer with normalized financial data tables.

Tables
------
  users               – RBAC users
  companies           – master record per company
  analysis_runs       – one row per analysis (stores full JSON result)
  financial_statements – parent record per year per analysis run
  financial_line_items – detailed line items (assets, liabilities, equity, income)
  financial_metrics    – top-level KPI metrics (raw extracted values only)
  financial_edits      – audit trail for all user edits with comments
  overview_edits       – field-level overrides for overview JSON data
  currency_rates       – global USD conversion rates per year + currency
  peer_ratings         – peer comparison scores

Design notes
------------
  * The DB stores only **raw extracted metrics** — no computed ratios.
  * Ratios are computed client-side (``computeRatios.ts``).
  * All write operations are logged with a ``[DB_WRITE]`` tag for traceability.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from typing import Dict, List, Optional

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

CREATE TABLE IF NOT EXISTS financial_statements (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_run_id  INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    year             INTEGER NOT NULL,
    currency         TEXT,
    UNIQUE(analysis_run_id, year)
);

CREATE TABLE IF NOT EXISTS financial_line_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id    INTEGER NOT NULL REFERENCES financial_statements(id) ON DELETE CASCADE,
    category        TEXT NOT NULL CHECK(category IN ('Asset','Liability','Equity','Income')),
    item_name       TEXT NOT NULL,
    value_reported  REAL,
    sort_order      INTEGER DEFAULT 0,
    is_total        BOOLEAN DEFAULT 0,
    data_source     TEXT DEFAULT 'Files Upload'
);

CREATE TABLE IF NOT EXISTS financial_metrics (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id      INTEGER NOT NULL REFERENCES financial_statements(id) ON DELETE CASCADE,
    metric_name       TEXT NOT NULL,
    metric_value      REAL,
    is_calculated     BOOLEAN NOT NULL DEFAULT 0,
    data_source       TEXT DEFAULT 'Files Upload',
    UNIQUE(statement_id, metric_name)
);

CREATE TABLE IF NOT EXISTS financial_edits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    statement_id    INTEGER NOT NULL REFERENCES financial_statements(id) ON DELETE CASCADE,
    line_item_id    INTEGER REFERENCES financial_line_items(id) ON DELETE SET NULL,
    metric_name     TEXT,
    old_value       REAL,
    new_value       REAL,
    comment         TEXT NOT NULL,
    edited_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    edited_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS overview_edits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    analysis_run_id INTEGER NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    field_path      TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT NOT NULL,
    comment         TEXT NOT NULL,
    edited_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    edited_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS currency_rates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    currency    TEXT NOT NULL,
    year        INTEGER NOT NULL,
    rate_to_usd REAL NOT NULL,
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(currency, year)
);

CREATE TABLE IF NOT EXISTS peer_ratings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id        INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    peer_company_name TEXT,
    run_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    result_json       TEXT
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
    logger.info("[DB] Database initialised at {}", str(DB_PATH))
    _seed_sample_data()


# ═══════════════════════════════════════════════════════════════════════════
# WRITE HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def upsert_company(name: str, industry: str | None = None) -> int:
    """Insert or get the company id (case-insensitive match on name)."""
    with _get_conn() as conn:
        if industry:
            conn.execute(
                "INSERT INTO companies (name, industry) VALUES (?, ?) "
                "ON CONFLICT(name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP, industry = ?",
                (name, industry, industry),
            )
        else:
            conn.execute(
                "INSERT INTO companies (name) VALUES (?) "
                "ON CONFLICT(name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP",
                (name,),
            )
        row = conn.execute(
            "SELECT id FROM companies WHERE name = ?", (name,)
        ).fetchone()
        company_id = row["id"]
    logger.info("[DB_WRITE] upsert_company name='{}' → id={}", name, company_id)
    return company_id


def create_run(company_id: int, status: str = "pending") -> int:
    """Create a new analysis_run and return its id."""
    with _get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO analysis_runs (company_id, status) VALUES (?, ?)",
            (company_id, status),
        )
        run_id = cursor.lastrowid
        conn.commit()
    logger.info("[DB_WRITE] create_run company_id={} → run_id={}", company_id, run_id)
    return run_id


def update_run(
    run_id: int,
    *,
    status: str,
    result: Optional[dict] = None,
    currency: Optional[str] = None,
    error: Optional[str] = None,
) -> None:
    """Update an analysis_run with its final result or error."""
    with _get_conn() as conn:
        if result:
            row = conn.execute(
                "SELECT company_id FROM analysis_runs WHERE id = ?", (run_id,)
            ).fetchone()
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

        # Persist normalized financial data when the run completes
        if result and status == "completed":
            financial_data = result.get("financial_data", [])
            _save_normalized_financial_data(conn, run_id, financial_data, currency)

        conn.commit()
    logger.info("[DB_WRITE] update_run run_id={} → status={}", run_id, status)


# ---------------------------------------------------------------------------
# Normalized financial data persistence
# ---------------------------------------------------------------------------

# Metrics that are stored as raw extracted values (no computed ratios)
_RAW_METRIC_FIELDS = {
    "total_assets", "total_liabilities", "total_equity",
    "total_operating_revenue", "total_operating_expenses",
    "pat", "net_interests", "ebitda",
    "gross_loan_portfolio", "gross_non_performing_loans",
    "total_loan_loss_provisions", "disbursals",
    "debts_to_clients", "debts_to_financial_institutions",
    "tier_1_capital", "risk_weighted_assets",
    "loans_with_arrears_over_30_days",
    "credit_rating",
}


def _save_normalized_financial_data(
    conn: sqlite3.Connection,
    run_id: int,
    financial_data: list,
    currency: str | None,
) -> None:
    """Extract financial data from JSON and save into normalized tables."""
    # Clear existing data for this run
    stmt_ids = [
        r["id"]
        for r in conn.execute(
            "SELECT id FROM financial_statements WHERE analysis_run_id = ?",
            (run_id,),
        ).fetchall()
    ]
    for sid in stmt_ids:
        conn.execute("DELETE FROM financial_line_items WHERE statement_id = ?", (sid,))
        conn.execute("DELETE FROM financial_metrics WHERE statement_id = ?", (sid,))
    conn.execute("DELETE FROM financial_statements WHERE analysis_run_id = ?", (run_id,))

    for block in financial_data:
        year = block.get("year")
        if not year:
            continue

        cursor = conn.execute(
            "INSERT INTO financial_statements (analysis_run_id, year, currency) VALUES (?, ?, ?)",
            (run_id, year, currency),
        )
        stmt_id = cursor.lastrowid

        fh = block.get("financial_health", {})

        for metric_name in _RAW_METRIC_FIELDS:
            value = fh.get(metric_name)
            if value is not None and value != -1:
                try:
                    conn.execute(
                        """INSERT OR REPLACE INTO financial_metrics
                           (statement_id, metric_name, metric_value, is_calculated, data_source)
                           VALUES (?, ?, ?, 0, 'Files Upload')""",
                        (stmt_id, metric_name, float(value)),
                    )
                except (ValueError, TypeError):
                    # credit_rating is a string — skip numeric insert
                    pass

        # ── Grouped Line Items ─────────────────────────────────────────────
        # Assets, Liabilities, Equity, and Income Statement line items.
        line_item_groups = {
            "asset_line_items": "Asset",
            "liabilities_line_items": "Liability",
            "equity_line_items": "Equity",
            "income_statement_line_items": "Income"
        }

        for schema_key, db_category in line_item_groups.items():
            items = fh.get(schema_key, [])
            if not isinstance(items, list):
                continue
                
            for itm in items:
                name = itm.get("item_name")
                val = itm.get("value_reported")
                if name and val is not None:
                    conn.execute("""
                        INSERT INTO financial_line_items (statement_id, category, item_name, value_reported)
                        VALUES (?, ?, ?, ?)
                    """, (stmt_id, db_category, name, val))

        logger.debug(
            "[DB_WRITE] Saved financial_statement run_id={} year={} stmt_id={}",
            run_id, year, stmt_id,
        )


# ═══════════════════════════════════════════════════════════════════════════
# FINANCIAL STATEMENT READ HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def get_financial_statements(run_id: int) -> List[Dict]:
    """Get all financial statements with line items and metrics for a run."""
    with _get_conn() as conn:
        stmts = conn.execute(
            "SELECT * FROM financial_statements WHERE analysis_run_id = ? ORDER BY year",
            (run_id,),
        ).fetchall()

        result: list[dict] = []
        for stmt in stmts:
            stmt_dict = dict(stmt)

            # Line items
            items = conn.execute(
                "SELECT * FROM financial_line_items WHERE statement_id = ? "
                "ORDER BY category, sort_order",
                (stmt["id"],),
            ).fetchall()
            stmt_dict["line_items"] = [dict(item) for item in items]

            # Metrics (raw only — ratios computed on the frontend)
            metrics = conn.execute(
                "SELECT * FROM financial_metrics WHERE statement_id = ?",
                (stmt["id"],),
            ).fetchall()
            stmt_dict["metrics"] = {m["metric_name"]: m["metric_value"] for m in metrics}
            stmt_dict["metrics_detail"] = [dict(m) for m in metrics]

            # Edit history
            edits = conn.execute(
                "SELECT fe.*, u.username "
                "FROM financial_edits fe "
                "LEFT JOIN users u ON fe.edited_by = u.id "
                "WHERE fe.statement_id = ? ORDER BY fe.edited_at DESC",
                (stmt["id"],),
            ).fetchall()
            stmt_dict["edit_history"] = [dict(e) for e in edits]

            result.append(stmt_dict)

        return result


def get_statement_by_id(statement_id: int) -> Optional[Dict]:
    """Get a single financial statement with all its data."""
    with _get_conn() as conn:
        stmt = conn.execute(
            "SELECT * FROM financial_statements WHERE id = ?", (statement_id,)
        ).fetchone()
        if not stmt:
            return None

        stmt_dict = dict(stmt)

        items = conn.execute(
            "SELECT * FROM financial_line_items WHERE statement_id = ? "
            "ORDER BY category, sort_order",
            (statement_id,),
        ).fetchall()
        stmt_dict["line_items"] = [dict(item) for item in items]

        metrics = conn.execute(
            "SELECT * FROM financial_metrics WHERE statement_id = ?",
            (statement_id,),
        ).fetchall()
        stmt_dict["metrics"] = {m["metric_name"]: m["metric_value"] for m in metrics}
        stmt_dict["metrics_detail"] = [dict(m) for m in metrics]

        edits = conn.execute(
            "SELECT fe.*, u.username "
            "FROM financial_edits fe "
            "LEFT JOIN users u ON fe.edited_by = u.id "
            "WHERE fe.statement_id = ? ORDER BY fe.edited_at DESC",
            (statement_id,),
        ).fetchall()
        stmt_dict["edit_history"] = [dict(e) for e in edits]

        return stmt_dict


# ═══════════════════════════════════════════════════════════════════════════
# FINANCIAL EDIT HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def save_financial_edit(
    statement_id: int,
    line_item_id: Optional[int],
    metric_name: Optional[str],
    old_value: float,
    new_value: float,
    comment: str,
    username: str = "admin",
) -> bool:
    """Save a financial edit with audit trail."""
    with _get_conn() as conn:
        user_row = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        user_id = user_row["id"] if user_row else None

        conn.execute(
            """INSERT INTO financial_edits
               (statement_id, line_item_id, metric_name, old_value, new_value, comment, edited_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (statement_id, line_item_id, metric_name, old_value, new_value, comment, user_id),
        )

        if line_item_id:
            conn.execute(
                "UPDATE financial_line_items SET value_reported = ?, data_source = 'Manually Edited' "
                "WHERE id = ?",
                (new_value, line_item_id),
            )
        elif metric_name:
            conn.execute(
                """INSERT OR REPLACE INTO financial_metrics
                   (statement_id, metric_name, metric_value, is_calculated, data_source)
                   VALUES (?, ?, ?, 0, 'Manually Edited')""",
                (statement_id, metric_name, new_value),
            )

        conn.commit()

    logger.info(
        "[DB_WRITE] save_financial_edit stmt_id={} metric={} line_item={} "
        "old={} new={} user='{}'",
        statement_id, metric_name, line_item_id, old_value, new_value, username,
    )
    return True


def update_line_item(line_item_id: int, new_value: float) -> bool:
    """Update a single line item value."""
    with _get_conn() as conn:
        conn.execute(
            "UPDATE financial_line_items SET value_reported = ?, data_source = 'Manually Edited' "
            "WHERE id = ?",
            (new_value, line_item_id),
        )
        conn.commit()
    logger.info("[DB_WRITE] update_line_item id={} → {}", line_item_id, new_value)
    return True


def update_metric(statement_id: int, metric_name: str, new_value: float) -> bool:
    """Update a single metric value."""
    with _get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO financial_metrics
               (statement_id, metric_name, metric_value, is_calculated, data_source)
               VALUES (?, ?, ?, 0, 'Manually Edited')""",
            (statement_id, metric_name, new_value),
        )
        conn.commit()
    logger.info(
        "[DB_WRITE] update_metric stmt_id={} metric='{}' → {}",
        statement_id, metric_name, new_value,
    )
    return True


def recalculate_line_item_percentages(statement_id: int) -> None:
    """Recalculate size_percent for all line items in a statement."""
    with _get_conn() as conn:
        for category in ("Asset", "Liability", "Equity", "Income"):
            items = conn.execute(
                "SELECT * FROM financial_line_items "
                "WHERE statement_id = ? AND category = ? AND is_total = 0",
                (statement_id, category),
            ).fetchall()

            total_row = conn.execute(
                "SELECT * FROM financial_line_items "
                "WHERE statement_id = ? AND category = ? AND is_total = 1",
                (statement_id, category),
            ).fetchone()

            if not total_row:
                continue

            total_val = sum(i["value_reported"] or 0 for i in items)

            conn.execute(
                "UPDATE financial_line_items SET value_reported = ? WHERE id = ?",
                (total_val, total_row["id"]),
            )

        conn.commit()
    logger.info(
        "[DB_WRITE] recalculate_line_item_percentages stmt_id={}", statement_id
    )


# ═══════════════════════════════════════════════════════════════════════════
# OVERVIEW EDITS
# ═══════════════════════════════════════════════════════════════════════════

def save_overview_edit(
    run_id: int,
    field_path: str,
    old_value: str,
    new_value: str,
    comment: str,
    username: str = "admin",
) -> bool:
    """Save an overview field edit."""
    with _get_conn() as conn:
        user_row = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        user_id = user_row["id"] if user_row else None

        conn.execute(
            """INSERT INTO overview_edits
               (analysis_run_id, field_path, old_value, new_value, comment, edited_by)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (run_id, field_path, old_value, new_value, comment, user_id),
        )
        conn.commit()

    logger.info(
        "[DB_WRITE] save_overview_edit run_id={} field='{}' user='{}'",
        run_id, field_path, username,
    )
    return True


def get_overview_edits(run_id: int) -> List[Dict]:
    """Get all overview edits for a run, latest first per field."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT oe.*, u.username FROM overview_edits oe
               LEFT JOIN users u ON oe.edited_by = u.id
               WHERE oe.analysis_run_id = ? ORDER BY oe.edited_at DESC""",
            (run_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def apply_overview_edits(run_id: int, data: dict) -> dict:
    """Apply overview edits to the result JSON data."""
    edits = get_overview_edits(run_id)

    # Group by field_path, take latest edit per field
    latest_edits: dict[str, dict] = {}
    for edit in edits:
        fp = edit["field_path"]
        if fp not in latest_edits:
            latest_edits[fp] = edit

    for field_path, edit in latest_edits.items():
        _set_nested_value(data, field_path, edit["new_value"])

    return data


def _set_nested_value(data: dict, path: str, value: str) -> None:
    """Set a value in a nested dict using dot notation with array indices."""
    parts = re.split(r"\.", path)
    current = data

    for part in parts[:-1]:
        match = re.match(r"(\w+)\[(\d+)\]", part)
        if match:
            key, idx = match.group(1), int(match.group(2))
            if key in current and isinstance(current[key], list) and idx < len(current[key]):
                current = current[key][idx]
            else:
                return
        else:
            if part in current and isinstance(current[part], dict):
                current = current[part]
            else:
                return

    last = parts[-1]
    match = re.match(r"(\w+)\[(\d+)\]", last)
    if match:
        key, idx = match.group(1), int(match.group(2))
        if key in current and isinstance(current[key], list) and idx < len(current[key]):
            current[key][idx] = value
    else:
        try:
            existing = current.get(last)
            # If the existing value is a list of strings, convert comma-separated
            # input back into a list (e.g. "UAE, Egypt" → ["UAE", "Egypt"]).
            if isinstance(existing, list) and all(isinstance(v, str) for v in existing):
                current[last] = [v.strip() for v in value.split(",") if v.strip()]
            elif isinstance(existing, (int, float)):
                current[last] = float(value) if "." in str(value) else int(value)
            else:
                current[last] = value
        except (ValueError, TypeError):
            current[last] = value


# ═══════════════════════════════════════════════════════════════════════════
# CURRENCY RATES
# ═══════════════════════════════════════════════════════════════════════════

def get_currency_rate(currency: str, year: int) -> Optional[float]:
    """Get the USD conversion rate for a currency and year."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT rate_to_usd FROM currency_rates WHERE currency = ? AND year = ?",
            (currency, year),
        ).fetchone()
    return row["rate_to_usd"] if row else None


def upsert_currency_rate(
    currency: str,
    year: int,
    rate: float,
    username: str = "admin",
) -> bool:
    """Insert or update a currency rate."""
    with _get_conn() as conn:
        user_row = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        user_id = user_row["id"] if user_row else None

        conn.execute(
            """INSERT INTO currency_rates (currency, year, rate_to_usd, updated_by)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(currency, year) DO UPDATE SET
               rate_to_usd = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP""",
            (currency, year, rate, user_id, rate, user_id),
        )
        conn.commit()

    logger.info(
        "[DB_WRITE] upsert_currency_rate {}:{} → rate={} user='{}'",
        currency, year, rate, username,
    )
    return True


def get_all_currency_rates() -> List[Dict]:
    """Get all currency rates."""
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM currency_rates ORDER BY year DESC, currency"
        ).fetchall()
    return [dict(r) for r in rows]


# ═══════════════════════════════════════════════════════════════════════════
# READ HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def get_latest_analysis(company_name: str) -> Optional[Dict]:
    """Return the most recent *completed* analysis for a company, or None."""
    with _get_conn() as conn:
        row = conn.execute(
            """SELECT c.id AS company_id, ar.id AS run_id,
                      ar.result_json, ar.currency, ar.run_at
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
    data["company_id"] = row["company_id"]
    data["company_name"] = company_name
    data["currency"] = row["currency"] or data.get("currency", "USD")
    data["run_id"] = row["run_id"]

    # Apply overview edits
    data = apply_overview_edits(row["run_id"], data)

    # Attach financial statements (raw metrics only)
    data["financial_statements"] = get_financial_statements(row["run_id"])

    logger.info(
        "[DB] Returning analysis for '{}' (company_id={}, run_id={})",
        company_name, row["company_id"], row["run_id"],
    )
    return data


def get_all_analyses() -> List[Dict]:
    """Return a list of all companies with their latest analysis timestamp."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT c.name AS company_name, c.industry,
                      MAX(ar.run_at) AS analyzed_at
               FROM companies c
               LEFT JOIN analysis_runs ar
                      ON ar.company_id = c.id AND ar.status = 'completed'
               GROUP BY c.id
               ORDER BY analyzed_at DESC"""
        ).fetchall()
    return [
        {
            "company_name": r["company_name"],
            "industry": r["industry"],
            "analyzed_at": r["analyzed_at"],
        }
        for r in rows
    ]


# ═══════════════════════════════════════════════════════════════════════════
# PEER RATINGS
# ═══════════════════════════════════════════════════════════════════════════

def save_peer_rating(company_name: str, result: dict) -> None:
    """Insert peer rating result for a company."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT id FROM companies WHERE name = ?", (company_name,)
        ).fetchone()
        if not row:
            logger.error("[DB] save_peer_rating failed: company '{}' not found", company_name)
            return

        company_id = row["id"]
        result["company_id"] = company_id

        conn.execute(
            "INSERT INTO peer_ratings (company_id, result_json) VALUES (?, ?)",
            (company_id, json.dumps(result)),
        )
        conn.commit()
    logger.info("[DB_WRITE] save_peer_rating company='{}'", company_name)


def get_peer_rating(company_name: str) -> Optional[Dict]:
    """Return the latest peer rating for a company, or None."""
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
        logger.info("[DB_WRITE] delete_company '{}'", company_name)
    return deleted


# ═══════════════════════════════════════════════════════════════════════════
# SAMPLE DATA SEEDING
# ═══════════════════════════════════════════════════════════════════════════

def _seed_sample_data() -> None:
    """Seed the database with realistic sample data if empty."""
    with _get_conn() as conn:
        count = conn.execute("SELECT COUNT(*) as c FROM companies").fetchone()["c"]
        if count > 0:
            return

        logger.info("[DB] Seeding sample data …")

        # ── Company 1: Emirates NBD ────────────────────────────────────────
        conn.execute(
            "INSERT INTO companies (id, name, industry) VALUES (1, 'Emirates NBD', 'Banking')"
        )

        result_json = json.dumps({
            "company_name": "Emirates NBD",
            "currency": "AED",
            "company_overview": {
                "description_of_products_and_services": (
                    "Emirates NBD is one of the largest banking groups in the Middle East, "
                    "offering retail banking, corporate banking, Islamic banking, investment "
                    "banking, and wealth management services across the UAE and international markets."
                ),
                "countries_of_operation": ["UAE", "Saudi Arabia", "Egypt", "India", "Singapore", "United Kingdom"],
                "management_team": [
                    {"name": "Hesham Abdulla Al Qassim", "position": "Chairman"},
                    {"name": "Shayne Nelson", "position": "Group CEO"},
                    {"name": "Patrick Sullivan", "position": "Group CFO"},
                    {"name": "Abdulla Qassem", "position": "Group COO"},
                ],
                "shareholder_structure": [
                    {"name": "Investment Corporation of Dubai", "ownership_percentage": 55.8},
                    {"name": "Public / Free Float", "ownership_percentage": 44.2},
                ],
                "strategic_partners": ["Visa", "Mastercard", "Oracle Financial Services", "Microsoft Azure"],
                "revenue_by_subsidiaries_or_country": [
                    {"subsidiary_or_country": "UAE", "total_operating_revenue": 18500000000},
                    {"subsidiary_or_country": "Egypt (EBI)", "total_operating_revenue": 3200000000},
                    {"subsidiary_or_country": "KSA", "total_operating_revenue": 1500000000},
                    {"subsidiary_or_country": "International", "total_operating_revenue": 1490000000},
                ],
                "operational_scale": {
                    "number_of_branches": 235,
                    "number_of_employees": 24500,
                    "number_of_customers": 14000000,
                },
            },
            "financial_data": [
                {
                    "year": 2023,
                    "financial_health": {
                        "total_operating_revenue": 21500000000,
                        "ebitda": 12800000000,
                        "pat": 5310000000,
                        "total_assets": 145000000000,
                        "total_operating_expenses": 8700000000,
                        "net_interests": 19200000000,
                        "gross_loan_portfolio": 72000000000,
                        "gross_non_performing_loans": 1290000000,
                        "total_loan_loss_provisions": 1080000000,
                        "total_equity": 15500000000,
                        "debts_to_clients": 117000000000,
                        "debts_to_financial_institutions": 12500000000,
                        "credit_rating": "A+",
                        "disbursals": 14000000000,
                        "loans_with_arrears_over_30_days": 1800000000,
                    },
                },
                {
                    "year": 2024,
                    "financial_health": {
                        "total_operating_revenue": 24690000000,
                        "ebitda": 15200000000,
                        "pat": 6750000000,
                        "total_assets": 158933083000,
                        "total_operating_expenses": 9490000000,
                        "net_interests": 22190000000,
                        "gross_loan_portfolio": 78888408000,
                        "gross_non_performing_loans": 1415000000,
                        "total_loan_loss_provisions": 1250000000,
                        "total_equity": 17377615000,
                        "debts_to_clients": 128184124000,
                        "debts_to_financial_institutions": 13360000000,
                        "credit_rating": "A+",
                        "disbursals": 16500000000,
                        "loans_with_arrears_over_30_days": 2100000000,
                    },
                },
            ],
            "anomalies_and_risks": [
                {
                    "category": "Concentration Risk",
                    "description": (
                        "High geographic concentration in UAE market (75% of revenue). "
                        "Egyptian subsidiary EBI faces currency devaluation risks."
                    ),
                    "severity_level": "Medium",
                    "valuation_impact": "Could apply a 5-8% discount on multiples due to geographic concentration risk.",
                    "negotiation_leverage": "Request detailed country-level P&L and stress test results for Egyptian operations.",
                },
                {
                    "category": "Regulatory Compliance",
                    "description": (
                        "Increasing CBUAE capital requirements and Basel III implementation "
                        "may require additional capital buffers."
                    ),
                    "severity_level": "Low",
                    "valuation_impact": "Minimal direct impact but may constrain dividend distributions in the medium term.",
                    "negotiation_leverage": "Review capital adequacy projections and dividend policy commitments.",
                },
            ],
            "quality_of_it": {
                "core_banking_systems": ["Oracle FLEXCUBE", "Temenos T24"],
                "digital_channel_adoption": "High - Liv. digital bank platform with 500K+ users, mobile banking penetration at 85%",
                "system_upgrades": ["Cloud migration to Azure (2023)", "AI-powered fraud detection (2024)"],
                "vendor_partnerships": ["Microsoft", "Oracle", "Infosys"],
                "cyber_incidents": [],
            },
            "macroeconomic_geo_view": [
                {
                    "country": "UAE",
                    "population": "10.1M",
                    "gdp_per_capita_ppp": "$78,255",
                    "gdp_growth_forecast": "4.2%",
                    "inflation": "2.3%",
                    "central_bank_interest_rate": "5.40%",
                    "unemployment_rate": "2.8%",
                    "country_risk_rating": "AA",
                    "corruption_perceptions_index_rank": "24",
                },
                {
                    "country": "Egypt",
                    "population": "109M",
                    "gdp_per_capita_ppp": "$16,979",
                    "gdp_growth_forecast": "4.1%",
                    "inflation": "28.5%",
                    "central_bank_interest_rate": "27.25%",
                    "unemployment_rate": "7.1%",
                    "country_risk_rating": "B-",
                    "corruption_perceptions_index_rank": "108",
                },
            ],
            "competitive_position": {
                "key_competitors": ["First Abu Dhabi Bank", "Abu Dhabi Commercial Bank", "Dubai Islamic Bank", "Mashreq Bank"],
                "market_share_data": "Second largest bank in UAE by assets with approximately 18% market share in retail banking.",
                "central_bank_sector_reports_summary": "UAE banking sector remains well-capitalized with average CAR above 17%. Credit growth expected at 8-10% in 2025.",
                "industry_studies_summary": "GCC banking sector benefits from strong oil revenues and economic diversification. Digital banking adoption accelerating.",
                "customer_growth_or_attrition_news": "Added 1.2M new customers in 2024, primarily through Liv. digital platform.",
            },
            "management_quality": [
                {
                    "name": "Shayne Nelson",
                    "position": "Group CEO",
                    "previous_experience": "30+ years in banking, former CEO of Standard Chartered Middle East",
                    "tenure_history": "CEO since 2013",
                },
                {
                    "name": "Patrick Sullivan",
                    "position": "Group CFO",
                    "previous_experience": "25+ years in financial services, former CFO at ANZ Banking Group",
                    "tenure_history": "CFO since 2018",
                },
            ],
            "data_sources": {
                "company_overview": {
                    "description_of_products_and_services": "Files Upload",
                    "countries_of_operation": "Web Search",
                    "management_team": "Files Upload",
                    "shareholder_structure": "Files Upload",
                    "strategic_partners": "Web Search",
                    "revenue_by_subsidiaries_or_country": "Files Upload",
                    "operational_scale": "Files Upload",
                },
                "financial_data": {},
            },
        })

        conn.execute(
            "INSERT INTO analysis_runs (id, company_id, status, currency, result_json) "
            "VALUES (1, 1, 'completed', 'AED', ?)",
            (result_json,),
        )

        # Financial statements 2024
        conn.execute(
            "INSERT INTO financial_statements (id, analysis_run_id, year, currency) "
            "VALUES (1, 1, 2024, 'AED')"
        )

        _seed_line_items(conn, stmt_id=1, year=2024)

        # Financial statements 2023
        conn.execute(
            "INSERT INTO financial_statements (id, analysis_run_id, year, currency) "
            "VALUES (2, 1, 2023, 'AED')"
        )

        _seed_line_items_2023(conn, stmt_id=2)

        # Metrics 2024
        for name, val in {
            "total_assets": 158933083000, "total_liabilities": 140003323000,
            "total_equity": 17377615000, "total_operating_revenue": 24690000000,
            "total_operating_expenses": 9490000000, "pat": 6750000000,
            "net_interests": 22190000000, "ebitda": 15200000000,
            "gross_loan_portfolio": 78888408000, "gross_non_performing_loans": 1415000000,
            "total_loan_loss_provisions": 1250000000, "debts_to_clients": 128184124000,
            "debts_to_financial_institutions": 13360000000,
        }.items():
            conn.execute(
                "INSERT INTO financial_metrics "
                "(statement_id, metric_name, metric_value, is_calculated, data_source) "
                "VALUES (1, ?, ?, 0, 'Files Upload')",
                (name, val),
            )

        # Metrics 2023
        for name, val in {
            "total_assets": 145000000000, "total_liabilities": 129396099000,
            "total_equity": 15500000000, "total_operating_revenue": 21500000000,
            "total_operating_expenses": 8700000000, "pat": 5310000000,
            "net_interests": 19200000000, "ebitda": 12800000000,
            "gross_loan_portfolio": 72000000000, "gross_non_performing_loans": 1290000000,
            "total_loan_loss_provisions": 1080000000, "debts_to_clients": 117000000000,
            "debts_to_financial_institutions": 12500000000,
        }.items():
            conn.execute(
                "INSERT INTO financial_metrics "
                "(statement_id, metric_name, metric_value, is_calculated, data_source) "
                "VALUES (2, ?, ?, 0, 'Files Upload')",
                (name, val),
            )

        # Currency rates
        for cur, yr, rate in [
            ("AED", 2024, 0.2723), ("AED", 2023, 0.2723),
            ("EGP", 2024, 0.0204), ("EGP", 2023, 0.0324),
        ]:
            conn.execute(
                "INSERT INTO currency_rates (currency, year, rate_to_usd) VALUES (?, ?, ?)",
                (cur, yr, rate),
            )

        # ── Company 2: Abu Dhabi Islamic Bank ──────────────────────────────
        conn.execute(
            "INSERT INTO companies (id, name, industry) "
            "VALUES (2, 'Abu Dhabi Islamic Bank PJSC', 'Banking')"
        )

        result_json_2 = json.dumps({
            "company_name": "Abu Dhabi Islamic Bank PJSC",
            "currency": "AED",
            "company_overview": {
                "description_of_products_and_services": (
                    "Abu Dhabi Islamic Bank (ADIB) is one of the leading Islamic financial "
                    "institutions globally, offering Sharia-compliant retail, corporate, and "
                    "investment banking services."
                ),
                "countries_of_operation": ["UAE", "Egypt", "United Kingdom"],
                "management_team": [
                    {"name": "Jawaan Awaidha Suhail Al Khaili", "position": "Chairman"},
                    {"name": "Nasser Al Awadhi", "position": "Group CEO"},
                ],
                "shareholder_structure": [
                    {"name": "Abu Dhabi Investment Council", "ownership_percentage": 61.6},
                    {"name": "Public / Free Float", "ownership_percentage": 38.4},
                ],
                "strategic_partners": ["Mastercard", "Visa"],
                "revenue_by_subsidiaries_or_country": [
                    {"subsidiary_or_country": "UAE", "total_operating_revenue": 9200000000},
                    {"subsidiary_or_country": "Egypt", "total_operating_revenue": 1431921000},
                ],
                "operational_scale": {
                    "number_of_branches": 68,
                    "number_of_employees": 5200,
                    "number_of_customers": 1100000,
                },
            },
            "financial_data": [
                {
                    "year": 2024,
                    "financial_health": {
                        "total_operating_revenue": 10631921000,
                        "pat": 6101417000,
                        "total_assets": 225909795000,
                        "total_equity": 28317238000,
                        "net_interests": 7784861000,
                        "total_operating_expenses": 3700000000,
                        "gross_loan_portfolio": 160000000000,
                        "gross_non_performing_loans": 3520000000,
                        "total_loan_loss_provisions": 2800000000,
                        "debts_to_clients": 182000000000,
                        "debts_to_financial_institutions": 15592557000,
                        "total_liabilities": 197592557000,
                    },
                },
            ],
            "anomalies_and_risks": [],
            "competitive_position": {
                "key_competitors": ["Emirates NBD", "Dubai Islamic Bank", "Mashreq Bank"],
                "market_share_data": "Third largest Islamic bank globally by assets.",
                "central_bank_sector_reports_summary": "Islamic banking growing at 12% CAGR in UAE.",
                "industry_studies_summary": "Sharia-compliant assets expected to reach $4T globally by 2026.",
                "customer_growth_or_attrition_news": "Added 150K new customers in 2024.",
            },
            "management_quality": [],
            "data_sources": {"company_overview": {}, "financial_data": {}},
        })

        conn.execute(
            "INSERT INTO analysis_runs (id, company_id, status, currency, result_json) "
            "VALUES (2, 2, 'completed', 'AED', ?)",
            (result_json_2,),
        )

        conn.execute(
            "INSERT INTO financial_statements (id, analysis_run_id, year, currency) "
            "VALUES (3, 2, 2024, 'AED')"
        )

        for name, val in {
            "total_assets": 225909795000, "total_liabilities": 197592557000,
            "total_equity": 28317238000, "total_operating_revenue": 10631921000,
            "total_operating_expenses": 3700000000, "pat": 6101417000,
            "net_interests": 7784861000, "gross_loan_portfolio": 160000000000,
            "gross_non_performing_loans": 3520000000, "total_loan_loss_provisions": 2800000000,
            "debts_to_clients": 182000000000, "debts_to_financial_institutions": 15592557000,
        }.items():
            conn.execute(
                "INSERT INTO financial_metrics "
                "(statement_id, metric_name, metric_value, is_calculated, data_source) "
                "VALUES (3, ?, ?, 0, 'Files Upload')",
                (name, val),
            )

        # ── Company 3: Wio Bank ────────────────────────────────────────────
        conn.execute(
            "INSERT INTO companies (id, name, industry) "
            "VALUES (3, 'Wio Bank PJSC', 'Banking')"
        )

        result_json_3 = json.dumps({
            "company_name": "Wio Bank PJSC",
            "currency": "AED",
            "company_overview": {
                "description_of_products_and_services": (
                    "Wio Bank is a digital-first bank in the UAE, offering innovative banking "
                    "solutions for individuals and SMEs through a fully digital platform."
                ),
                "countries_of_operation": ["UAE"],
                "management_team": [
                    {"name": "Salem Al Noaimi", "position": "Chairman"},
                    {"name": "Jayesh Patel", "position": "CEO"},
                ],
                "shareholder_structure": [
                    {"name": "ADQ", "ownership_percentage": 25.0},
                    {"name": "Alpha Dhabi", "ownership_percentage": 25.0},
                    {"name": "Etisalat", "ownership_percentage": 25.0},
                    {"name": "First Abu Dhabi Bank", "ownership_percentage": 25.0},
                ],
                "strategic_partners": ["Etisalat", "First Abu Dhabi Bank"],
                "revenue_by_subsidiaries_or_country": [
                    {"subsidiary_or_country": "UAE", "total_operating_revenue": 1253619000},
                ],
                "operational_scale": {
                    "number_of_branches": 0,
                    "number_of_employees": 450,
                    "number_of_customers": 500000,
                },
            },
            "financial_data": [
                {
                    "year": 2024,
                    "financial_health": {
                        "total_operating_revenue": 1253619000,
                        "pat": 394983000,
                        "total_assets": 37354676000,
                        "total_equity": 2206217000,
                        "net_interests": 900304000,
                        "total_operating_expenses": 858636000,
                        "gross_loan_portfolio": 830000000,
                        "gross_non_performing_loans": 0,
                        "total_loan_loss_provisions": 0,
                        "debts_to_clients": 34800000000,
                        "debts_to_financial_institutions": 348459000,
                        "total_liabilities": 35148459000,
                    },
                },
            ],
            "anomalies_and_risks": [],
            "competitive_position": {
                "key_competitors": ["Zand Bank", "YAP", "Mashreq Neo"],
                "market_share_data": "Fastest growing digital bank in UAE with 500K customers.",
                "central_bank_sector_reports_summary": "Digital banking licenses expanding in UAE.",
                "industry_studies_summary": "Digital banking penetration in GCC expected to reach 40% by 2027.",
                "customer_growth_or_attrition_news": "Tripled customer base in 2024.",
            },
            "management_quality": [],
            "data_sources": {"company_overview": {}, "financial_data": {}},
        })

        conn.execute(
            "INSERT INTO analysis_runs (id, company_id, status, currency, result_json) "
            "VALUES (3, 3, 'completed', 'AED', ?)",
            (result_json_3,),
        )

        conn.execute(
            "INSERT INTO financial_statements (id, analysis_run_id, year, currency) "
            "VALUES (4, 3, 2024, 'AED')"
        )

        for name, val in {
            "total_assets": 37354676000, "total_liabilities": 35148459000,
            "total_equity": 2206217000, "total_operating_revenue": 1253619000,
            "total_operating_expenses": 858636000, "pat": 394983000,
            "net_interests": 900304000, "gross_loan_portfolio": 830000000,
            "gross_non_performing_loans": 0, "total_loan_loss_provisions": 0,
            "debts_to_clients": 34800000000, "debts_to_financial_institutions": 348459000,
        }.items():
            conn.execute(
                "INSERT INTO financial_metrics "
                "(statement_id, metric_name, metric_value, is_calculated, data_source) "
                "VALUES (4, ?, ?, 0, 'Files Upload')",
                (name, val),
            )

        # Peer ratings for Emirates NBD
        peer_rating_data = json.dumps({
            "target_company": "Emirates NBD",
            "companies": [
                {"company_name": "Emirates NBD", "pat": 1837.575, "total_equity": 4731.1, "roe": 38.8, "gross_loan_portfolio": 21479.2, "currency": "USDm"},
                {"company_name": "Abu Dhabi Islamic Bank PJSC", "pat": 1661.2, "total_equity": 7708.8, "roe": 21.5, "gross_loan_portfolio": 43552.0, "currency": "USDm"},
                {"company_name": "Wio Bank PJSC", "pat": 107.6, "total_equity": 600.5, "roe": 17.9, "gross_loan_portfolio": 226.1, "currency": "USDm"},
            ],
            "scores": {
                "Emirates NBD": [
                    {"criterion": "Contribution to Profitability", "score": 4.5, "justification": "Strong ROE and consistent profit growth"},
                    {"criterion": "Size of Transaction", "score": 4.0, "justification": "Large-scale bank with significant asset base"},
                    {"criterion": "Geographic / Strategic Fit", "score": 3.5, "justification": "Strong UAE presence with growing international footprint"},
                    {"criterion": "Product / Market Strategy Fit", "score": 4.0, "justification": "Comprehensive product suite across retail and corporate"},
                    {"criterion": "Ease of Execution", "score": 3.0, "justification": "Complex regulatory environment and large workforce"},
                    {"criterion": "Quality & Depth of Management", "score": 4.5, "justification": "Experienced leadership team with strong track record"},
                    {"criterion": "Strategic Partners", "score": 3.5, "justification": "Good technology partnerships"},
                    {"criterion": "Quality of IT & Data", "score": 4.0, "justification": "Strong digital platform with Liv."},
                    {"criterion": "Competitor Positioning", "score": 4.0, "justification": "Second largest bank in UAE"},
                ],
            },
            "overall_scores": {"Emirates NBD": 3.9},
            "summaries": {
                "Emirates NBD": (
                    "Emirates NBD is a strong acquisition target with robust profitability, "
                    "experienced management, and a leading market position in the UAE."
                ),
            },
        })

        conn.execute(
            "INSERT INTO peer_ratings (company_id, result_json) VALUES (1, ?)",
            (peer_rating_data,),
        )

        conn.commit()
        logger.info("[DB] Sample data seeded successfully")


# ---------------------------------------------------------------------------
# Seed helper: line items (extracted to reduce _seed_sample_data length)
# ---------------------------------------------------------------------------

def _seed_line_items(conn: sqlite3.Connection, stmt_id: int, year: int) -> None:
    """Insert line items for the 2024 Emirates NBD statement."""
    _insert_items = lambda items: [
        conn.execute(
            """INSERT INTO financial_line_items
               (id, statement_id, category, item_name, value_reported,
                size_percent, change_percent, absolute_change, sort_order, is_total, data_source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            item,
        )
        for item in items
    ]

    _insert_items([
        (1, stmt_id, "Asset", "Loans and advances to customers (net)", 78888408000, 49.64, 42.0, 23171645000, 1, 0, "Files Upload"),
        (2, stmt_id, "Asset", "Due from banks", 49997020000, 31.46, 239.0, 35264273000, 2, 0, "Files Upload"),
        (3, stmt_id, "Asset", "Treasury bills", 12908423000, 8.12, -61.0, -20371244000, 3, 0, "Files Upload"),
        (4, stmt_id, "Asset", "Financial investments at amortized cost", 7057117000, 4.44, 97.0, 3483620000, 4, 0, "Files Upload"),
        (5, stmt_id, "Asset", "Other assets", 10082115000, 6.34, 15.0, 1318128000, 5, 0, "Files Upload"),
        (6, stmt_id, "Asset", "Total", 158933083000, 100.0, 24.0, 30814422000, 99, 1, "Files Upload"),
    ])

    _insert_items([
        (7, stmt_id, "Liability", "Customers' deposits", 128184124000, 91.56, 25.0, 25528295000, 1, 0, "Files Upload"),
        (8, stmt_id, "Liability", "Due to banks", 4992284000, 3.56, -35.0, -2682067000, 2, 0, "Files Upload"),
        (9, stmt_id, "Liability", "Other liabilities", 3600771000, 2.57, 45.0, 1115478000, 3, 0, "Files Upload"),
        (10, stmt_id, "Liability", "Other loans", 2622211000, 1.87, 18.0, 394656000, 4, 0, "Files Upload"),
        (11, stmt_id, "Liability", "Other provisions", 587287000, 0.42, 55.0, 209314000, 5, 0, "Files Upload"),
        (12, stmt_id, "Liability", "Total", 140003323000, 100.0, 20.0, 23488563000, 99, 1, "Files Upload"),
    ])

    _insert_items([
        (13, stmt_id, "Equity", "Retained earnings", 11399250000, 65.60, 73.0, 4828955000, 1, 0, "Files Upload"),
        (14, stmt_id, "Equity", "Issued and paid up capital", 5000000000, 28.77, 0.0, 0, 2, 0, "Files Upload"),
        (15, stmt_id, "Equity", "Reserves", 978365000, 5.63, 2811.0, 944759000, 3, 0, "Files Upload"),
        (16, stmt_id, "Equity", "Total", 17377615000, 100.0, 50.0, 5773714000, 99, 1, "Files Upload"),
    ])

    _insert_items([
        (17, stmt_id, "Income", "Interest from loans and similar income", 23630524000, 213.0, 50.0, 7927720000, 1, 0, "Files Upload"),
        (18, stmt_id, "Income", "Cost of deposits and similar expenses", -12533845000, -113.0, -49.0, -4094806000, 2, 0, "Files Upload"),
        (19, stmt_id, "Income", "Net interest income", 11096679000, 100.0, 53.0, 3832914000, 3, 0, "Files Upload"),
        (20, stmt_id, "Income", "Fees and commissions income", 2279052000, 21.0, 50.0, 755435000, 4, 0, "Files Upload"),
        (21, stmt_id, "Income", "Fees and commissions expenses", -583950000, -5.0, -44.0, -179366000, 5, 0, "Files Upload"),
        (22, stmt_id, "Income", "Net fees and commissions income", 1695102000, 15.0, 51.0, 576069000, 6, 0, "Files Upload"),
        (23, stmt_id, "Income", "Dividends income", 2382000, 0.0, 3.0, 78000, 7, 0, "Files Upload"),
        (24, stmt_id, "Income", "Net trading income", 766289000, 7.0, 191.0, 503391000, 8, 0, "Files Upload"),
        (25, stmt_id, "Income", "Gain on financial investment", 32929000, 0.0, 1.0, 384000, 9, 0, "Files Upload"),
        (26, stmt_id, "Income", "Impairment charges of credit losses", -1669249000, -15.0, -8.0, -127532000, 10, 0, "Files Upload"),
        (27, stmt_id, "Income", "Administrative expenses", -2707618000, -24.0, -39.0, -755975000, 11, 0, "Files Upload"),
        (28, stmt_id, "Income", "Other operating expenses", -1678898000, -15.0, -458.0, -1377946000, 12, 0, "Files Upload"),
        (29, stmt_id, "Income", "Profit for the year before income tax", 7537616000, 68.0, 54.0, 2651382000, 13, 0, "Files Upload"),
        (30, stmt_id, "Income", "Income tax expense", -787616000, -7.0, -120.0, -430000000, 14, 0, "Files Upload"),
        (31, stmt_id, "Income", "Net income (PAT)", 6750000000, 61.0, 27.0, 1440000000, 99, 1, "Files Upload"),
    ])


def _seed_line_items_2023(conn: sqlite3.Connection, stmt_id: int) -> None:
    """Insert simplified 2023 line items for Emirates NBD."""
    _insert = lambda items: [
        conn.execute(
            """INSERT INTO financial_line_items
               (id, statement_id, category, item_name, value_reported,
                size_percent, change_percent, absolute_change, sort_order, is_total, data_source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            item,
        )
        for item in items
    ]

    _insert([
        (32, stmt_id, "Asset", "Loans and advances to customers (net)", 55716763000, 43.14, 0, 0, 1, 0, "Files Upload"),
        (33, stmt_id, "Asset", "Due from banks", 14732747000, 11.41, 0, 0, 2, 0, "Files Upload"),
        (34, stmt_id, "Asset", "Treasury bills", 33279667000, 25.77, 0, 0, 3, 0, "Files Upload"),
        (35, stmt_id, "Asset", "Financial investments at amortized cost", 3573497000, 2.77, 0, 0, 4, 0, "Files Upload"),
        (36, stmt_id, "Asset", "Other assets", 21815987000, 16.89, 0, 0, 5, 0, "Files Upload"),
        (37, stmt_id, "Asset", "Total", 129118661000, 100.0, 0, 0, 99, 1, "Files Upload"),
    ])

    _insert([
        (38, stmt_id, "Liability", "Customers' deposits", 102655829000, 88.12, 0, 0, 1, 0, "Files Upload"),
        (39, stmt_id, "Liability", "Due to banks", 7674351000, 6.59, 0, 0, 2, 0, "Files Upload"),
        (40, stmt_id, "Liability", "Other liabilities", 2485293000, 2.13, 0, 0, 3, 0, "Files Upload"),
        (41, stmt_id, "Liability", "Other loans", 2227555000, 1.91, 0, 0, 4, 0, "Files Upload"),
        (42, stmt_id, "Liability", "Other provisions", 377973000, 0.32, 0, 0, 5, 0, "Files Upload"),
        (43, stmt_id, "Liability", "Total", 116514760000, 100.0, 0, 0, 99, 1, "Files Upload"),
    ])

    _insert([
        (44, stmt_id, "Equity", "Retained earnings", 6570295000, 52.0, 0, 0, 1, 0, "Files Upload"),
        (45, stmt_id, "Equity", "Issued and paid up capital", 5000000000, 39.6, 0, 0, 2, 0, "Files Upload"),
        (46, stmt_id, "Equity", "Reserves", 33606000, 0.27, 0, 0, 3, 0, "Files Upload"),
        (47, stmt_id, "Equity", "Total", 11603901000, 100.0, 0, 0, 99, 1, "Files Upload"),
    ])
