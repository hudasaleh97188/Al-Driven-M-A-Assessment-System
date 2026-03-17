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
    operation       TEXT DEFAULT 'UPDATE' CHECK(operation IN ('UPDATE', 'ADD', 'DELETE')),
    item_name       TEXT,
    category        TEXT,
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
        
        # Migration: Add new columns to financial_edits if they don't exist
        try:
            conn.execute("ALTER TABLE financial_edits ADD COLUMN operation TEXT DEFAULT 'UPDATE'")
            conn.execute("ALTER TABLE financial_edits ADD COLUMN item_name TEXT")
            conn.execute("ALTER TABLE financial_edits ADD COLUMN category TEXT")
        except sqlite3.OperationalError:
            # Columns already exist
            pass
            
        conn.commit()
    logger.info("[DB] Database initialised at {}", str(DB_PATH))
    _seed_currency_rates()


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
                # Handle credit_rating as string, others as float if possible
                save_val = value
                if metric_name != "credit_rating":
                    try:
                        save_val = float(value)
                    except (ValueError, TypeError):
                        pass

                conn.execute(
                    """INSERT OR REPLACE INTO financial_metrics
                       (statement_id, metric_name, metric_value, is_calculated, data_source)
                       VALUES (?, ?, ?, 0, 'Files Upload')""",
                    (stmt_id, metric_name, save_val),
                )

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

            # Apply overlays
            stmt_dict = apply_financial_edits(stmt_dict)

            result.append(stmt_dict)

        return result


def apply_financial_edits(stmt_dict: dict) -> dict:
    """
    Overlay financial_edits onto the base statement data.
    This allows 'Add' and 'Delete' logic without mutating the original line items.
    """
    edits = stmt_dict.get("edit_history", [])
    if not edits:
        return stmt_dict

    # Sort by edited_at ascending to apply changes in sequence
    sorted_edits = sorted(edits, key=lambda x: x["edited_at"])

    line_items = {item["id"]: item for item in stmt_dict.get("line_items", [])}
    metrics = stmt_dict.get("metrics", {})
    
    # Track deleted item IDs and names for new items
    deleted_line_item_ids = set()
    added_line_items = [] # list of dicts

    for edit in sorted_edits:
        op = edit.get("operation", "UPDATE")
        li_id = edit.get("line_item_id")
        m_name = edit.get("metric_name")
        val = edit.get("new_value")

        if op == "UPDATE":
            if li_id and li_id in line_items:
                line_items[li_id]["value_reported"] = val
                line_items[li_id]["data_source"] = "Manually Edited"
            elif m_name:
                metrics[m_name] = val
        
        elif op == "DELETE":
            if li_id:
                deleted_line_item_ids.add(li_id)
            elif m_name:
                # We don't really 'delete' top level metrics usually, but if we do:
                metrics.pop(m_name, None)
        
        elif op == "ADD":
            # For ADD, we expect category and item_name
            cat = edit.get("category")
            name = edit.get("item_name")
            if cat and name:
                added_line_items.append({
                    "id": None, # Indicates it's an overlay item
                    "statement_id": stmt_dict["id"],
                    "category": cat,
                    "item_name": name,
                    "value_reported": val,
                    "sort_order": 999, # Put at bottom
                    "is_total": False,
                    "data_source": "Manually Added"
                })

    # Filter out deleted items and combine with added items
    final_line_items = [
        item for item in stmt_dict.get("line_items", []) 
        if item["id"] not in deleted_line_item_ids
    ]
    final_line_items.extend(added_line_items)

    stmt_dict["line_items"] = final_line_items
    stmt_dict["metrics"] = metrics
    
    return stmt_dict


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

        # Apply overlays
        stmt_dict = apply_financial_edits(stmt_dict)

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
    operation: str = "UPDATE",
    item_name: Optional[str] = None,
    category: Optional[str] = None,
) -> bool:
    """Save a financial edit with audit trail."""
    with _get_conn() as conn:
        user_row = conn.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone()
        user_id = user_row["id"] if user_row else None

        conn.execute(
            """INSERT INTO financial_edits
               (statement_id, line_item_id, metric_name, operation, item_name, category, 
                old_value, new_value, comment, edited_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                statement_id, line_item_id, metric_name, operation, item_name, category,
                old_value, new_value, comment, user_id
            ),
        )

        # Note: We NO LONGER mutate financial_line_items or financial_metrics directly.
        # Everything is applied via apply_financial_edits (overlay approach).
        # This preserves the original extracted data for audit trail/revert.

        conn.commit()

    logger.info(
        "[DB_WRITE] save_financial_edit stmt_id={} op={} metric={} item='{}' "
        "old={} new={} user='{}'",
        statement_id, operation, metric_name, item_name or line_item_id, 
        old_value, new_value, username,
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
    """Get the USD conversion rate for a currency and year.

    Lookup order:
      1. Exact (currency, year) match.
      2. If not found, fall back to the *latest* year available for that
         currency (so a 2025 report still gets converted even if only 2024
         rates are seeded).
    Returns None only when the currency is entirely absent from the table.
    """
    currency = currency.upper().strip()
    with _get_conn() as conn:
        # 1. Exact match
        row = conn.execute(
            "SELECT rate_to_usd, year FROM currency_rates WHERE currency = ? AND year = ?",
            (currency, year),
        ).fetchone()
        if row:
            return row["rate_to_usd"]

        # 2. Latest available year for this currency
        row = conn.execute(
            "SELECT rate_to_usd, year FROM currency_rates "
            "WHERE currency = ? ORDER BY year DESC LIMIT 1",
            (currency,),
        ).fetchone()

    if row:
        logger.warning(
            "[DB] No rate for {}/{} – using latest available year {} (rate={})",
            currency, year, row["year"], row["rate_to_usd"],
        )
        return row["rate_to_usd"]

    logger.warning("[DB] Currency '{}' not found in currency_rates at all", currency)
    return None


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


def _seed_currency_rates() -> None:
    """
    Ensure the currency_rates table is populated with annual USD conversion
    rates for 2023, 2024 and 2025.

    Uses INSERT OR IGNORE so that any rates already entered via the admin UI
    are never overwritten — only genuinely missing rows are added.

    Rates are annual averages sourced from IMF / World Bank / central banks.
    Pegged currencies (AED, SAR, BHD, OMR, QAR, JOD) carry the same rate
    across all years.  Volatile currencies (EGP, NGN, TRY, GHS, ETB) reflect
    real-world devaluations.
    """
    RATES = [
        # ── Gulf / MENA ──────────────────────────────────────────────────────
        # UAE Dirham (pegged 3.6725 / USD)
        ("AED", 2023, 0.2723), ("AED", 2024, 0.2723), ("AED", 2025, 0.2723),
        # Saudi Riyal (pegged 3.75 / USD)
        ("SAR", 2023, 0.2667), ("SAR", 2024, 0.2667), ("SAR", 2025, 0.2667),
        # Bahraini Dinar (pegged 0.376 / USD)
        ("BHD", 2023, 2.6596), ("BHD", 2024, 2.6596), ("BHD", 2025, 2.6596),
        # Kuwaiti Dinar
        ("KWD", 2023, 3.2573), ("KWD", 2024, 3.2520), ("KWD", 2025, 3.2500),
        # Omani Rial (pegged 0.3845 / USD)
        ("OMR", 2023, 2.5974), ("OMR", 2024, 2.5974), ("OMR", 2025, 2.5974),
        # Qatari Riyal (pegged 3.64 / USD)
        ("QAR", 2023, 0.2747), ("QAR", 2024, 0.2747), ("QAR", 2025, 0.2747),
        # Jordanian Dinar (pegged ~0.709 / USD)
        ("JOD", 2023, 1.4104), ("JOD", 2024, 1.4104), ("JOD", 2025, 1.4104),
        # Egyptian Pound (large devaluations 2023 → 2024)
        ("EGP", 2023, 0.0324), ("EGP", 2024, 0.0204), ("EGP", 2025, 0.0200),
        # Moroccan Dirham
        ("MAD", 2023, 0.09930), ("MAD", 2024, 0.10060), ("MAD", 2025, 0.10000),
        # Tunisian Dinar
        ("TND", 2023, 0.32300), ("TND", 2024, 0.31980), ("TND", 2025, 0.32000),
        # Lebanese Pound
        ("LBP", 2023, 0.0000111), ("LBP", 2024, 0.0000111), ("LBP", 2025, 0.0000111),
        # Turkish Lira
        ("TRY", 2023, 0.03840), ("TRY", 2024, 0.03090), ("TRY", 2025, 0.02780),
        # ── Sub-Saharan Africa ───────────────────────────────────────────────
        # Nigerian Naira
        ("NGN", 2023, 0.001294), ("NGN", 2024, 0.000625), ("NGN", 2025, 0.000600),
        # Kenyan Shilling
        ("KES", 2023, 0.007000), ("KES", 2024, 0.007750), ("KES", 2025, 0.007700),
        # Ghanaian Cedi
        ("GHS", 2023, 0.08400), ("GHS", 2024, 0.06280), ("GHS", 2025, 0.06000),
        # South African Rand
        ("ZAR", 2023, 0.05400), ("ZAR", 2024, 0.05490), ("ZAR", 2025, 0.05400),
        # Ethiopian Birr
        ("ETB", 2023, 0.01810), ("ETB", 2024, 0.00760), ("ETB", 2025, 0.00720),
        # Tanzanian Shilling
        ("TZS", 2023, 0.000402), ("TZS", 2024, 0.000388), ("TZS", 2025, 0.000385),
        # Ugandan Shilling
        ("UGX", 2023, 0.000268), ("UGX", 2024, 0.000268), ("UGX", 2025, 0.000265),
        # Rwandan Franc
        ("RWF", 2023, 0.000830), ("RWF", 2024, 0.000790), ("RWF", 2025, 0.000780),
        # ── South / South-East Asia ──────────────────────────────────────────
        # Indian Rupee
        ("INR", 2023, 0.012050), ("INR", 2024, 0.012000), ("INR", 2025, 0.011650),
        # Pakistani Rupee
        ("PKR", 2023, 0.003520), ("PKR", 2024, 0.003580), ("PKR", 2025, 0.003550),
        # Bangladeshi Taka
        ("BDT", 2023, 0.009100), ("BDT", 2024, 0.009130), ("BDT", 2025, 0.009100),
        # Indonesian Rupiah
        ("IDR", 2023, 0.0000652), ("IDR", 2024, 0.0000618), ("IDR", 2025, 0.0000610),
        # ── Major global currencies ──────────────────────────────────────────
        ("USD", 2023, 1.0000), ("USD", 2024, 1.0000), ("USD", 2025, 1.0000),
        ("EUR", 2023, 1.0813), ("EUR", 2024, 1.0816), ("EUR", 2025, 1.0500),
        ("GBP", 2023, 1.2437), ("GBP", 2024, 1.2773), ("GBP", 2025, 1.2600),
    ]

    with _get_conn() as conn:
        conn.executemany(
            "INSERT OR IGNORE INTO currency_rates (currency, year, rate_to_usd) "
            "VALUES (?, ?, ?)",
            RATES,
        )
        conn.commit()

    logger.info("[DB] _seed_currency_rates: {} rate entries ensured", len(RATES))