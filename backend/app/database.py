"""
database.py
-----------
SQLite persistence layer with normalized financial data tables.

Tables:
  - users              – RBAC users
  - companies           – master record per company
  - analysis_runs       – one row per analysis (stores full JSON result for overview)
  - financial_statements – parent record per year per analysis run
  - financial_line_items – detailed line items (assets, liabilities, equity, income)
  - financial_metrics    – top-level KPI metrics
  - financial_edits      – audit trail for all user edits with comments
  - overview_edits       – field-level overrides for overview JSON data
  - currency_rates       – global USD conversion rates per year+currency
  - peer_ratings         – peer comparison scores
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
    size_percent    REAL,
    change_percent  REAL,
    absolute_change REAL,
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
    logger.info("Database initialised at {}", str(DB_PATH))
    _seed_sample_data()


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------

def upsert_company(name: str, industry: str = None) -> int:
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
        
        # Save normalized financial data if completed
        if result and status == "completed":
            financial_data = result.get("financial_data", [])
            _save_normalized_financial_data(conn, run_id, financial_data, currency)
            
        conn.commit()
    logger.info("[DB] Updated run_id={} -> status={}", run_id, status)


def _save_normalized_financial_data(conn, run_id, financial_data, currency):
    """Extract financial data from JSON and save into normalized tables."""
    # Clear existing data for this run
    stmt_ids = [r["id"] for r in conn.execute(
        "SELECT id FROM financial_statements WHERE analysis_run_id = ?", (run_id,)
    ).fetchall()]
    for sid in stmt_ids:
        conn.execute("DELETE FROM financial_line_items WHERE statement_id = ?", (sid,))
        conn.execute("DELETE FROM financial_metrics WHERE statement_id = ?", (sid,))
    conn.execute("DELETE FROM financial_statements WHERE analysis_run_id = ?", (run_id,))
    
    for block in financial_data:
        year = block.get("year")
        if not year:
            continue
        
        # Create financial_statement record
        cursor = conn.execute(
            "INSERT INTO financial_statements (analysis_run_id, year, currency) VALUES (?, ?, ?)",
            (run_id, year, currency)
        )
        stmt_id = cursor.lastrowid
        
        fh = block.get("financial_health", {})
        
        # Save top-level metrics
        metric_fields = {
            'total_assets': False, 'total_liabilities': False, 'total_equity': False,
            'total_operating_revenue': False, 'total_operating_expenses': False,
            'pat': False, 'net_interests': False, 'ebitda': False,
            'gross_loan_portfolio': False, 'gross_non_performing_loans': False,
            'total_loan_loss_provisions': False, 'disbursals': False,
            'debts_to_clients': False, 'debts_to_financial_institutions': False,
            'tier_1_capital': False, 'risk_weighted_assets': False,
            'loans_with_arrears_over_30_days': False,
            'credit_rating': False,
        }
        
        for metric_name, is_calc in metric_fields.items():
            value = fh.get(metric_name)
            if value is not None and isinstance(value, (int, float)):
                conn.execute(
                    """INSERT OR REPLACE INTO financial_metrics 
                       (statement_id, metric_name, metric_value, is_calculated, data_source)
                       VALUES (?, ?, ?, ?, 'Files Upload')""",
                    (stmt_id, metric_name, float(value), is_calc)
                )


# ---------------------------------------------------------------------------
# Financial Statement Read helpers
# ---------------------------------------------------------------------------

def get_financial_statements(run_id: int) -> List[Dict]:
    """Get all financial statements with line items and metrics for a run."""
    with _get_conn() as conn:
        stmts = conn.execute(
            "SELECT * FROM financial_statements WHERE analysis_run_id = ? ORDER BY year",
            (run_id,)
        ).fetchall()
        
        result = []
        for stmt in stmts:
            stmt_dict = dict(stmt)
            
            # Get line items
            items = conn.execute(
                "SELECT * FROM financial_line_items WHERE statement_id = ? ORDER BY category, sort_order",
                (stmt["id"],)
            ).fetchall()
            stmt_dict["line_items"] = [dict(item) for item in items]
            
            # Get metrics
            metrics = conn.execute(
                "SELECT * FROM financial_metrics WHERE statement_id = ?",
                (stmt["id"],)
            ).fetchall()
            stmt_dict["metrics"] = {m["metric_name"]: m["metric_value"] for m in metrics}
            stmt_dict["metrics_detail"] = [dict(m) for m in metrics]
            
            # Get edit history
            edits = conn.execute(
                "SELECT fe.*, u.username FROM financial_edits fe LEFT JOIN users u ON fe.edited_by = u.id WHERE fe.statement_id = ? ORDER BY fe.edited_at DESC",
                (stmt["id"],)
            ).fetchall()
            stmt_dict["edit_history"] = [dict(e) for e in edits]
            
            result.append(stmt_dict)
        
        return result


def save_financial_edit(statement_id: int, line_item_id: Optional[int], metric_name: Optional[str],
                        old_value: float, new_value: float, comment: str, username: str = "admin") -> bool:
    """Save a financial edit with audit trail."""
    with _get_conn() as conn:
        user_row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        user_id = user_row["id"] if user_row else None
        
        conn.execute(
            """INSERT INTO financial_edits 
               (statement_id, line_item_id, metric_name, old_value, new_value, comment, edited_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (statement_id, line_item_id, metric_name, old_value, new_value, comment, user_id)
        )
        
        # Update the actual value
        if line_item_id:
            conn.execute(
                "UPDATE financial_line_items SET value_reported = ?, data_source = 'Manually Edited' WHERE id = ?",
                (new_value, line_item_id)
            )
        elif metric_name:
            conn.execute(
                """INSERT OR REPLACE INTO financial_metrics 
                   (statement_id, metric_name, metric_value, is_calculated, data_source)
                   VALUES (?, ?, ?, 0, 'Manually Edited')""",
                (statement_id, metric_name, new_value)
            )
        
        conn.commit()
    return True


def update_line_item(line_item_id: int, new_value: float) -> bool:
    """Update a single line item value."""
    with _get_conn() as conn:
        conn.execute(
            "UPDATE financial_line_items SET value_reported = ?, data_source = 'Manually Edited' WHERE id = ?",
            (new_value, line_item_id)
        )
        conn.commit()
    return True


def update_metric(statement_id: int, metric_name: str, new_value: float) -> bool:
    """Update a single metric value."""
    with _get_conn() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO financial_metrics 
               (statement_id, metric_name, metric_value, is_calculated, data_source)
               VALUES (?, ?, ?, 0, 'Manually Edited')""",
            (statement_id, metric_name, new_value)
        )
        conn.commit()
    return True


def recalculate_line_item_percentages(statement_id: int) -> None:
    """Recalculate size_percent for all line items in a statement."""
    with _get_conn() as conn:
        for category in ['Asset', 'Liability', 'Equity', 'Income']:
            items = conn.execute(
                "SELECT * FROM financial_line_items WHERE statement_id = ? AND category = ? AND is_total = 0",
                (statement_id, category)
            ).fetchall()
            
            total_row = conn.execute(
                "SELECT * FROM financial_line_items WHERE statement_id = ? AND category = ? AND is_total = 1",
                (statement_id, category)
            ).fetchone()
            
            if not total_row:
                continue
                
            total_val = sum(i["value_reported"] or 0 for i in items)
            
            # Update total
            conn.execute(
                "UPDATE financial_line_items SET value_reported = ? WHERE id = ?",
                (total_val, total_row["id"])
            )
            
            # Update percentages
            for item in items:
                pct = (item["value_reported"] / total_val * 100) if total_val != 0 else 0
                conn.execute(
                    "UPDATE financial_line_items SET size_percent = ? WHERE id = ?",
                    (round(pct, 2), item["id"])
                )
            
            conn.execute(
                "UPDATE financial_line_items SET size_percent = 100.0 WHERE id = ?",
                (total_row["id"],)
            )
        
        conn.commit()


# ---------------------------------------------------------------------------
# Overview Edits
# ---------------------------------------------------------------------------

def save_overview_edit(run_id: int, field_path: str, old_value: str, new_value: str, 
                       comment: str, username: str = "admin") -> bool:
    """Save an overview field edit."""
    with _get_conn() as conn:
        user_row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        user_id = user_row["id"] if user_row else None
        
        conn.execute(
            """INSERT INTO overview_edits 
               (analysis_run_id, field_path, old_value, new_value, comment, edited_by)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (run_id, field_path, old_value, new_value, comment, user_id)
        )
        conn.commit()
    return True


def get_overview_edits(run_id: int) -> List[Dict]:
    """Get all overview edits for a run, latest first per field."""
    with _get_conn() as conn:
        rows = conn.execute(
            """SELECT oe.*, u.username FROM overview_edits oe 
               LEFT JOIN users u ON oe.edited_by = u.id 
               WHERE oe.analysis_run_id = ? ORDER BY oe.edited_at DESC""",
            (run_id,)
        ).fetchall()
    return [dict(r) for r in rows]


def apply_overview_edits(run_id: int, data: dict) -> dict:
    """Apply overview edits to the result JSON data."""
    edits = get_overview_edits(run_id)
    
    # Group by field_path, take latest edit per field
    latest_edits = {}
    for edit in edits:
        fp = edit["field_path"]
        if fp not in latest_edits:
            latest_edits[fp] = edit
    
    for field_path, edit in latest_edits.items():
        _set_nested_value(data, field_path, edit["new_value"])
    
    return data


def _set_nested_value(data: dict, path: str, value: str):
    """Set a value in a nested dict using dot notation with array indices."""
    import re
    parts = re.split(r'\.', path)
    current = data
    for i, part in enumerate(parts[:-1]):
        # Handle array index like management_team[0]
        match = re.match(r'(\w+)\[(\d+)\]', part)
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
    match = re.match(r'(\w+)\[(\d+)\]', last)
    if match:
        key, idx = match.group(1), int(match.group(2))
        if key in current and isinstance(current[key], list) and idx < len(current[key]):
            current[key][idx] = value
    else:
        # Try to preserve type
        try:
            if isinstance(current.get(last), (int, float)):
                current[last] = float(value) if '.' in str(value) else int(value)
            else:
                current[last] = value
        except (ValueError, TypeError):
            current[last] = value


# ---------------------------------------------------------------------------
# Currency Rates
# ---------------------------------------------------------------------------

def get_currency_rate(currency: str, year: int) -> Optional[float]:
    """Get the USD conversion rate for a currency and year."""
    with _get_conn() as conn:
        row = conn.execute(
            "SELECT rate_to_usd FROM currency_rates WHERE currency = ? AND year = ?",
            (currency, year)
        ).fetchone()
    return row["rate_to_usd"] if row else None


def upsert_currency_rate(currency: str, year: int, rate: float, username: str = "admin") -> bool:
    """Insert or update a currency rate."""
    with _get_conn() as conn:
        user_row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        user_id = user_row["id"] if user_row else None
        
        conn.execute(
            """INSERT INTO currency_rates (currency, year, rate_to_usd, updated_by)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(currency, year) DO UPDATE SET 
               rate_to_usd = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP""",
            (currency, year, rate, user_id, rate, user_id)
        )
        conn.commit()
    return True


def get_all_currency_rates() -> List[Dict]:
    """Get all currency rates."""
    with _get_conn() as conn:
        rows = conn.execute("SELECT * FROM currency_rates ORDER BY year DESC, currency").fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Read helpers (existing, updated)
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
    data["company_id"] = row["company_id"]
    data["company_name"] = company_name
    data["currency"] = row["currency"] or data.get("currency", "USD")
    data["run_id"] = row["run_id"]
    
    # Apply overview edits
    data = apply_overview_edits(row["run_id"], data)
    
    # Get financial statements
    fin_stmts = get_financial_statements(row["run_id"])
    data["financial_statements"] = fin_stmts
    
    logger.info("[DB] Returning analysis for '{}' (company_id={}, run_id={})", 
                company_name, row["company_id"], row["run_id"])
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
    return [{"company_name": r["company_name"], "industry": r["industry"], "analyzed_at": r["analyzed_at"]} for r in rows]


def save_peer_rating(company_name: str, result: dict) -> None:
    """Insert peer rating result for a company."""
    with _get_conn() as conn:
        row = conn.execute("SELECT id FROM companies WHERE name = ?", (company_name,)).fetchone()
        if not row:
            logger.error("[DB] save_peer_rating failed: Company '{}' not found", company_name)
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
    return deleted


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
            "SELECT * FROM financial_line_items WHERE statement_id = ? ORDER BY category, sort_order",
            (statement_id,)
        ).fetchall()
        stmt_dict["line_items"] = [dict(item) for item in items]
        
        metrics = conn.execute(
            "SELECT * FROM financial_metrics WHERE statement_id = ?",
            (statement_id,)
        ).fetchall()
        stmt_dict["metrics"] = {m["metric_name"]: m["metric_value"] for m in metrics}
        stmt_dict["metrics_detail"] = [dict(m) for m in metrics]
        
        edits = conn.execute(
            "SELECT fe.*, u.username FROM financial_edits fe LEFT JOIN users u ON fe.edited_by = u.id WHERE fe.statement_id = ? ORDER BY fe.edited_at DESC",
            (statement_id,)
        ).fetchall()
        stmt_dict["edit_history"] = [dict(e) for e in edits]
        
        return stmt_dict


# ---------------------------------------------------------------------------
# Sample Data Seeding
# ---------------------------------------------------------------------------

def _seed_sample_data():
    """Seed the database with realistic sample data if empty."""
    with _get_conn() as conn:
        count = conn.execute("SELECT COUNT(*) as c FROM companies").fetchone()["c"]
        if count > 0:
            return
        
        logger.info("[DB] Seeding sample data...")
        
        # ── Company 1: Emirates NBD ──
        conn.execute("INSERT INTO companies (id, name, industry) VALUES (1, 'Emirates NBD', 'Banking')")
        
        # Analysis run with full JSON
        result_json = json.dumps({
            "company_name": "Emirates NBD",
            "currency": "AED",
            "company_overview": {
                "description_of_products_and_services": "Emirates NBD is one of the largest banking groups in the Middle East, offering retail banking, corporate banking, Islamic banking, investment banking, and wealth management services across the UAE and international markets.",
                "countries_of_operation": ["UAE", "Saudi Arabia", "Egypt", "India", "Singapore", "United Kingdom"],
                "management_team": [
                    {"name": "Hesham Abdulla Al Qassim", "position": "Chairman"},
                    {"name": "Shayne Nelson", "position": "Group CEO"},
                    {"name": "Patrick Sullivan", "position": "Group CFO"},
                    {"name": "Abdulla Qassem", "position": "Group COO"}
                ],
                "shareholder_structure": [
                    {"name": "Investment Corporation of Dubai", "ownership_percentage": 55.8},
                    {"name": "Public / Free Float", "ownership_percentage": 44.2}
                ],
                "strategic_partners": ["Visa", "Mastercard", "Oracle Financial Services", "Microsoft Azure"],
                "revenue_by_subsidiaries_or_country": [
                    {"subsidiary_or_country": "UAE", "total_operating_revenue": 18500000},
                    {"subsidiary_or_country": "Egypt (EBI)", "total_operating_revenue": 3200000},
                    {"subsidiary_or_country": "KSA", "total_operating_revenue": 1500000},
                    {"subsidiary_or_country": "International", "total_operating_revenue": 1490000}
                ],
                "operational_scale": {
                    "number_of_branches": 235,
                    "number_of_employees": 24500,
                    "number_of_customers": 14000000
                }
            },
            "financial_data": [
                {
                    "year": 2023,
                    "financial_health": {
                        "total_operating_revenue": 21500000,
                        "ebitda": 12800000,
                        "pat": 5310000,
                        "total_assets": 145000000,
                        "total_operating_expenses": 8700000,
                        "net_interests": 19200000,
                        "gross_loan_portfolio": 72000000,
                        "gross_non_performing_loans": 1290000,
                        "total_loan_loss_provisions": 1080000,
                        "total_equity": 15500000,
                        "debts_to_clients": 117000000,
                        "debts_to_financial_institutions": 12500000,
                        "credit_rating": "A+",
                        "disbursals": 14000000,
                        "loans_with_arrears_over_30_days": 1800000,
                        "equity_to_glp_percent": 21.5
                    }
                },
                {
                    "year": 2024,
                    "financial_health": {
                        "total_operating_revenue": 24690000,
                        "ebitda": 15200000,
                        "pat": 6750000,
                        "total_assets": 158933083,
                        "total_operating_expenses": 9490000,
                        "net_interests": 22190000,
                        "gross_loan_portfolio": 78888408,
                        "gross_non_performing_loans": 1415000,
                        "total_loan_loss_provisions": 1250000,
                        "total_equity": 17377615,
                        "debts_to_clients": 128184124,
                        "debts_to_financial_institutions": 13360000,
                        "credit_rating": "A+",
                        "disbursals": 16500000,
                        "loans_with_arrears_over_30_days": 2100000,
                        "equity_to_glp_percent": 22.0
                    }
                }
            ],
            "anomalies_and_risks": [
                {
                    "category": "Concentration Risk",
                    "description": "High geographic concentration in UAE market (75% of revenue). Egyptian subsidiary EBI faces currency devaluation risks.",
                    "severity_level": "Medium",
                    "valuation_impact": "Could apply a 5-8% discount on multiples due to geographic concentration risk.",
                    "negotiation_leverage": "Request detailed country-level P&L and stress test results for Egyptian operations."
                },
                {
                    "category": "Regulatory Compliance",
                    "description": "Increasing CBUAE capital requirements and Basel III implementation may require additional capital buffers.",
                    "severity_level": "Low",
                    "valuation_impact": "Minimal direct impact but may constrain dividend distributions in the medium term.",
                    "negotiation_leverage": "Review capital adequacy projections and dividend policy commitments."
                }
            ],
            "quality_of_it": {
                "core_banking_systems": ["Oracle FLEXCUBE", "Temenos T24"],
                "digital_channel_adoption": "High - Liv. digital bank platform with 500K+ users, mobile banking penetration at 85%",
                "system_upgrades": ["Cloud migration to Azure (2023)", "AI-powered fraud detection (2024)"],
                "vendor_partnerships": ["Microsoft", "Oracle", "Infosys"],
                "cyber_incidents": []
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
                    "corruption_perceptions_index_rank": "24"
                },
                {
                    "country": "Egypt",
                    "population": "109M",
                    "gdp_per_capita_ppp": "$16,979",
                    "gdp_growth_forecast": "3.8%",
                    "inflation": "28.5%",
                    "central_bank_interest_rate": "27.25%",
                    "unemployment_rate": "7.1%",
                    "country_risk_rating": "B-",
                    "corruption_perceptions_index_rank": "108"
                }
            ],
            "competitive_position": {
                "key_competitors": ["First Abu Dhabi Bank", "Abu Dhabi Commercial Bank", "Dubai Islamic Bank", "Mashreq Bank"],
                "market_share_data": "Second largest bank in UAE by assets with approximately 18% market share in retail banking.",
                "central_bank_sector_reports_summary": "UAE banking sector remains well-capitalized with average CAR above 17%. Credit growth expected at 8-10% in 2025.",
                "industry_studies_summary": "GCC banking sector benefits from strong oil revenues and economic diversification. Digital banking adoption accelerating.",
                "customer_growth_or_attrition_news": "Added 1.2M new customers in 2024, primarily through Liv. digital platform."
            },
            "management_quality": [
                {"name": "Shayne Nelson", "position": "Group CEO", "previous_experience": "30+ years in banking, former CEO of Standard Chartered Middle East", "tenure_history": "CEO since 2013"},
                {"name": "Patrick Sullivan", "position": "Group CFO", "previous_experience": "25+ years in financial services, former CFO at ANZ Banking Group", "tenure_history": "CFO since 2018"}
            ],
            "data_sources": {
                "company_overview": {
                    "description_of_products_and_services": "Files Upload",
                    "countries_of_operation": "Web Search",
                    "management_team": "Files Upload",
                    "shareholder_structure": "Files Upload",
                    "strategic_partners": "Web Search",
                    "revenue_by_subsidiaries_or_country": "Files Upload",
                    "operational_scale": "Files Upload"
                },
                "financial_data": {}
            }
        })
        
        conn.execute(
            "INSERT INTO analysis_runs (id, company_id, status, currency, result_json) VALUES (1, 1, 'completed', 'AED', ?)",
            (result_json,)
        )
        
        # ── Financial Statements for 2024 ──
        conn.execute(
            "INSERT INTO financial_statements (id, analysis_run_id, year, currency) VALUES (1, 1, 2024, 'AED')"
        )
        
        # Asset line items (2024)
        asset_items = [
            (1, 1, 'Asset', 'Loans and advances to customers (net)', 78888408, 49.64, 42.0, 23171645, 1, 0, 'Files Upload'),
            (2, 1, 'Asset', 'Due from banks', 49997020, 31.46, 239.0, 35264273, 2, 0, 'Files Upload'),
            (3, 1, 'Asset', 'Treasury bills', 12908423, 8.12, -61.0, -20371244, 3, 0, 'Files Upload'),
            (4, 1, 'Asset', 'Financial investments at amortized cost', 7057117, 4.44, 97.0, 3483620, 4, 0, 'Files Upload'),
            (5, 1, 'Asset', 'Other assets', 10082115, 6.34, 15.0, 1318128, 5, 0, 'Files Upload'),
            (6, 1, 'Asset', 'Total', 158933083, 100.0, 24.0, 30814422, 99, 1, 'Files Upload'),
        ]
        for item in asset_items:
            conn.execute(
                """INSERT INTO financial_line_items 
                   (id, statement_id, category, item_name, value_reported, size_percent, change_percent, absolute_change, sort_order, is_total, data_source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                item
            )
        
        # Liability line items (2024)
        liability_items = [
            (7, 1, 'Liability', "Customers' deposits", 128184124, 91.56, 25.0, 25528295, 1, 0, 'Files Upload'),
            (8, 1, 'Liability', 'Due to banks', 4992284, 3.56, -35.0, -2682067, 2, 0, 'Files Upload'),
            (9, 1, 'Liability', 'Other liabilities', 3600771, 2.57, 45.0, 1115478, 3, 0, 'Files Upload'),
            (10, 1, 'Liability', 'Other loans', 2622211, 1.87, 18.0, 394656, 4, 0, 'Files Upload'),
            (11, 1, 'Liability', 'Other provisions', 587287, 0.42, 55.0, 209314, 5, 0, 'Files Upload'),
            (12, 1, 'Liability', 'Total', 140003323, 100.0, 20.0, 23488563, 99, 1, 'Files Upload'),
        ]
        for item in liability_items:
            conn.execute(
                """INSERT INTO financial_line_items 
                   (id, statement_id, category, item_name, value_reported, size_percent, change_percent, absolute_change, sort_order, is_total, data_source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                item
            )
        
        # Equity line items (2024)
        equity_items = [
            (13, 1, 'Equity', 'Retained earnings', 11399250, 65.60, 73.0, 4828955, 1, 0, 'Files Upload'),
            (14, 1, 'Equity', 'Issued and paid up capital', 5000000, 28.77, 0.0, 0, 2, 0, 'Files Upload'),
            (15, 1, 'Equity', 'Reserves', 978365, 5.63, 2811.0, 944759, 3, 0, 'Files Upload'),
            (16, 1, 'Equity', 'Total', 17377615, 100.0, 50.0, 5773714, 99, 1, 'Files Upload'),
        ]
        for item in equity_items:
            conn.execute(
                """INSERT INTO financial_line_items 
                   (id, statement_id, category, item_name, value_reported, size_percent, change_percent, absolute_change, sort_order, is_total, data_source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                item
            )
        
        # Income statement line items (2024)
        income_items = [
            (17, 1, 'Income', 'Interest from loans and similar income', 23630524, 213.0, 50.0, 7927720, 1, 0, 'Files Upload'),
            (18, 1, 'Income', 'Cost of deposits and similar expenses', -12533845, -113.0, -49.0, -4094806, 2, 0, 'Files Upload'),
            (19, 1, 'Income', 'Net interest income', 11096679, 100.0, 53.0, 3832914, 3, 0, 'Files Upload'),
            (20, 1, 'Income', 'Fees and commissions income', 2279052, 21.0, 50.0, 755435, 4, 0, 'Files Upload'),
            (21, 1, 'Income', 'Fees and commissions expenses', -583950, -5.0, -44.0, -179366, 5, 0, 'Files Upload'),
            (22, 1, 'Income', 'Net fees and commissions income', 1695102, 15.0, 51.0, 576069, 6, 0, 'Files Upload'),
            (23, 1, 'Income', 'Dividends income', 2382, 0.0, 3.0, 78, 7, 0, 'Files Upload'),
            (24, 1, 'Income', 'Net trading income', 766289, 7.0, 191.0, 503391, 8, 0, 'Files Upload'),
            (25, 1, 'Income', 'Gain on financial investment', 32929, 0.0, 1.0, 384, 9, 0, 'Files Upload'),
            (26, 1, 'Income', 'Impairment charges of credit losses', -1669249, -15.0, -8.0, -127532, 10, 0, 'Files Upload'),
            (27, 1, 'Income', 'Administrative expenses', -2707618, -24.0, -39.0, -755975, 11, 0, 'Files Upload'),
            (28, 1, 'Income', 'Other operating expenses', -1678898, -15.0, -458.0, -1377946, 12, 0, 'Files Upload'),
            (29, 1, 'Income', 'Profit for the year before income tax', 7537616, 68.0, 54.0, 2651382, 13, 0, 'Files Upload'),
            (30, 1, 'Income', 'Income tax expense', -787616, -7.0, -120.0, -430000, 14, 0, 'Files Upload'),
            (31, 1, 'Income', 'Net income (PAT)', 6750000, 61.0, 27.0, 1440000, 99, 1, 'Files Upload'),
        ]
        for item in income_items:
            conn.execute(
                """INSERT INTO financial_line_items 
                   (id, statement_id, category, item_name, value_reported, size_percent, change_percent, absolute_change, sort_order, is_total, data_source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                item
            )
        
        # ── Financial Statements for 2023 ──
        conn.execute(
            "INSERT INTO financial_statements (id, analysis_run_id, year, currency) VALUES (2, 1, 2023, 'AED')"
        )
        
        # Simplified 2023 asset items
        asset_items_2023 = [
            (32, 2, 'Asset', 'Loans and advances to customers (net)', 55716763, 43.14, 0, 0, 1, 0, 'Files Upload'),
            (33, 2, 'Asset', 'Due from banks', 14732747, 11.41, 0, 0, 2, 0, 'Files Upload'),
            (34, 2, 'Asset', 'Treasury bills', 33279667, 25.77, 0, 0, 3, 0, 'Files Upload'),
            (35, 2, 'Asset', 'Financial investments at amortized cost', 3573497, 2.77, 0, 0, 4, 0, 'Files Upload'),
            (36, 2, 'Asset', 'Other assets', 21815987, 16.89, 0, 0, 5, 0, 'Files Upload'),
            (37, 2, 'Asset', 'Total', 129118661, 100.0, 0, 0, 99, 1, 'Files Upload'),
        ]
        for item in asset_items_2023:
            conn.execute(
                """INSERT INTO financial_line_items 
                   (id, statement_id, category, item_name, value_reported, size_percent, change_percent, absolute_change, sort_order, is_total, data_source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                item
            )
        
        liability_items_2023 = [
            (38, 2, 'Liability', "Customers' deposits", 102655829, 88.12, 0, 0, 1, 0, 'Files Upload'),
            (39, 2, 'Liability', 'Due to banks', 7674351, 6.59, 0, 0, 2, 0, 'Files Upload'),
            (40, 2, 'Liability', 'Other liabilities', 2485293, 2.13, 0, 0, 3, 0, 'Files Upload'),
            (41, 2, 'Liability', 'Other loans', 2227555, 1.91, 0, 0, 4, 0, 'Files Upload'),
            (42, 2, 'Liability', 'Other provisions', 377973, 0.32, 0, 0, 5, 0, 'Files Upload'),
            (43, 2, 'Liability', 'Total', 116514760, 100.0, 0, 0, 99, 1, 'Files Upload'),
        ]
        for item in liability_items_2023:
            conn.execute(
                """INSERT INTO financial_line_items 
                   (id, statement_id, category, item_name, value_reported, size_percent, change_percent, absolute_change, sort_order, is_total, data_source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                item
            )
        
        equity_items_2023 = [
            (44, 2, 'Equity', 'Retained earnings', 6570295, 52.0, 0, 0, 1, 0, 'Files Upload'),
            (45, 2, 'Equity', 'Issued and paid up capital', 5000000, 39.6, 0, 0, 2, 0, 'Files Upload'),
            (46, 2, 'Equity', 'Reserves', 33606, 0.27, 0, 0, 3, 0, 'Files Upload'),
            (47, 2, 'Equity', 'Total', 11603901, 100.0, 0, 0, 99, 1, 'Files Upload'),
        ]
        for item in equity_items_2023:
            conn.execute(
                """INSERT INTO financial_line_items 
                   (id, statement_id, category, item_name, value_reported, size_percent, change_percent, absolute_change, sort_order, is_total, data_source)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                item
            )
        
        # Top-level metrics for 2024
        metrics_2024 = {
            'total_assets': 158933083, 'total_liabilities': 140003323, 'total_equity': 17377615,
            'total_operating_revenue': 24690000, 'total_operating_expenses': 9490000,
            'pat': 6750000, 'net_interests': 22190000, 'ebitda': 15200000,
            'gross_loan_portfolio': 78888408, 'gross_non_performing_loans': 1415000,
            'total_loan_loss_provisions': 1250000, 'debts_to_clients': 128184124,
            'debts_to_financial_institutions': 13360000,
        }
        for name, val in metrics_2024.items():
            conn.execute(
                "INSERT INTO financial_metrics (statement_id, metric_name, metric_value, is_calculated, data_source) VALUES (1, ?, ?, 0, 'Files Upload')",
                (name, val)
            )
        
        # Top-level metrics for 2023
        metrics_2023 = {
            'total_assets': 129118661, 'total_liabilities': 116514760, 'total_equity': 11603901,
            'total_operating_revenue': 21500000, 'total_operating_expenses': 8700000,
            'pat': 5310000, 'net_interests': 19200000, 'ebitda': 12800000,
            'gross_loan_portfolio': 72000000, 'gross_non_performing_loans': 1290000,
            'total_loan_loss_provisions': 1080000, 'debts_to_clients': 117000000,
            'debts_to_financial_institutions': 12500000,
        }
        for name, val in metrics_2023.items():
            conn.execute(
                "INSERT INTO financial_metrics (statement_id, metric_name, metric_value, is_calculated, data_source) VALUES (2, ?, ?, 0, 'Files Upload')",
                (name, val)
            )
        
        # Currency rates
        conn.execute("INSERT INTO currency_rates (currency, year, rate_to_usd) VALUES ('AED', 2024, 0.2723)")
        conn.execute("INSERT INTO currency_rates (currency, year, rate_to_usd) VALUES ('AED', 2023, 0.2723)")
        conn.execute("INSERT INTO currency_rates (currency, year, rate_to_usd) VALUES ('EGP', 2024, 0.0204)")
        conn.execute("INSERT INTO currency_rates (currency, year, rate_to_usd) VALUES ('EGP', 2023, 0.0324)")
        
        # ── Company 2: Abu Dhabi Islamic Bank ──
        conn.execute("INSERT INTO companies (id, name, industry) VALUES (2, 'Abu Dhabi Islamic Bank PJSC', 'Banking')")
        
        result_json_2 = json.dumps({
            "company_name": "Abu Dhabi Islamic Bank PJSC",
            "currency": "AED",
            "company_overview": {
                "description_of_products_and_services": "Abu Dhabi Islamic Bank (ADIB) is one of the leading Islamic financial institutions globally, offering Sharia-compliant retail, corporate, and investment banking services.",
                "countries_of_operation": ["UAE", "Egypt", "United Kingdom"],
                "management_team": [
                    {"name": "Jawaan Awaidha Suhail Al Khaili", "position": "Chairman"},
                    {"name": "Nasser Al Awadhi", "position": "Group CEO"}
                ],
                "shareholder_structure": [
                    {"name": "Abu Dhabi Investment Council", "ownership_percentage": 61.6},
                    {"name": "Public / Free Float", "ownership_percentage": 38.4}
                ],
                "strategic_partners": ["Mastercard", "Visa"],
                "revenue_by_subsidiaries_or_country": [
                    {"subsidiary_or_country": "UAE", "total_operating_revenue": 9200000},
                    {"subsidiary_or_country": "Egypt", "total_operating_revenue": 1431921}
                ],
                "operational_scale": {
                    "number_of_branches": 68,
                    "number_of_employees": 5200,
                    "number_of_customers": 1100000
                }
            },
            "financial_data": [
                {
                    "year": 2024,
                    "financial_health": {
                        "total_operating_revenue": 10631921,
                        "pat": 6101417,
                        "total_assets": 225909795,
                        "total_equity": 28317238,
                        "net_interests": 7784861,
                        "total_operating_expenses": 3700000,
                        "gross_loan_portfolio": 160000000,
                        "gross_non_performing_loans": 3520000,
                        "total_loan_loss_provisions": 2800000,
                        "debts_to_clients": 182000000,
                        "debts_to_financial_institutions": 15592557,
                        "total_liabilities": 197592557
                    }
                }
            ],
            "anomalies_and_risks": [],
            "competitive_position": {
                "key_competitors": ["Emirates NBD", "Dubai Islamic Bank", "Mashreq Bank"],
                "market_share_data": "Third largest Islamic bank globally by assets.",
                "central_bank_sector_reports_summary": "Islamic banking growing at 12% CAGR in UAE.",
                "industry_studies_summary": "Sharia-compliant assets expected to reach $4T globally by 2026.",
                "customer_growth_or_attrition_news": "Added 150K new customers in 2024."
            },
            "management_quality": [],
            "data_sources": {"company_overview": {}, "financial_data": {}}
        })
        
        conn.execute(
            "INSERT INTO analysis_runs (id, company_id, status, currency, result_json) VALUES (2, 2, 'completed', 'AED', ?)",
            (result_json_2,)
        )
        
        conn.execute("INSERT INTO financial_statements (id, analysis_run_id, year, currency) VALUES (3, 2, 2024, 'AED')")
        
        metrics_adib = {
            'total_assets': 225909795, 'total_liabilities': 197592557, 'total_equity': 28317238,
            'total_operating_revenue': 10631921, 'total_operating_expenses': 3700000,
            'pat': 6101417, 'net_interests': 7784861,
            'gross_loan_portfolio': 160000000, 'gross_non_performing_loans': 3520000,
            'total_loan_loss_provisions': 2800000, 'debts_to_clients': 182000000,
            'debts_to_financial_institutions': 15592557,
        }
        for name, val in metrics_adib.items():
            conn.execute(
                "INSERT INTO financial_metrics (statement_id, metric_name, metric_value, is_calculated, data_source) VALUES (3, ?, ?, 0, 'Files Upload')",
                (name, val)
            )
        
        # ── Company 3: Wio Bank ──
        conn.execute("INSERT INTO companies (id, name, industry) VALUES (3, 'Wio Bank PJSC', 'Banking')")
        
        result_json_3 = json.dumps({
            "company_name": "Wio Bank PJSC",
            "currency": "AED",
            "company_overview": {
                "description_of_products_and_services": "Wio Bank is a digital-first bank in the UAE, offering innovative banking solutions for individuals and SMEs through a fully digital platform.",
                "countries_of_operation": ["UAE"],
                "management_team": [
                    {"name": "Salem Al Noaimi", "position": "Chairman"},
                    {"name": "Jayesh Patel", "position": "CEO"}
                ],
                "shareholder_structure": [
                    {"name": "ADQ", "ownership_percentage": 25.0},
                    {"name": "Alpha Dhabi", "ownership_percentage": 25.0},
                    {"name": "Etisalat", "ownership_percentage": 25.0},
                    {"name": "First Abu Dhabi Bank", "ownership_percentage": 25.0}
                ],
                "strategic_partners": ["Etisalat", "First Abu Dhabi Bank"],
                "revenue_by_subsidiaries_or_country": [
                    {"subsidiary_or_country": "UAE", "total_operating_revenue": 1253619}
                ],
                "operational_scale": {
                    "number_of_branches": 0,
                    "number_of_employees": 450,
                    "number_of_customers": 500000
                }
            },
            "financial_data": [
                {
                    "year": 2024,
                    "financial_health": {
                        "total_operating_revenue": 1253619,
                        "pat": 394983,
                        "total_assets": 37354676,
                        "total_equity": 2206217,
                        "net_interests": 900304,
                        "total_operating_expenses": 858636,
                        "gross_loan_portfolio": 830000,
                        "gross_non_performing_loans": 0,
                        "total_loan_loss_provisions": 0,
                        "debts_to_clients": 34800000,
                        "debts_to_financial_institutions": 348459,
                        "total_liabilities": 35148459
                    }
                }
            ],
            "anomalies_and_risks": [],
            "competitive_position": {
                "key_competitors": ["Zand Bank", "YAP", "Mashreq Neo"],
                "market_share_data": "Fastest growing digital bank in UAE with 500K customers.",
                "central_bank_sector_reports_summary": "Digital banking licenses expanding in UAE.",
                "industry_studies_summary": "Digital banking penetration in GCC expected to reach 40% by 2027.",
                "customer_growth_or_attrition_news": "Tripled customer base in 2024."
            },
            "management_quality": [],
            "data_sources": {"company_overview": {}, "financial_data": {}}
        })
        
        conn.execute(
            "INSERT INTO analysis_runs (id, company_id, status, currency, result_json) VALUES (3, 3, 'completed', 'AED', ?)",
            (result_json_3,)
        )
        
        conn.execute("INSERT INTO financial_statements (id, analysis_run_id, year, currency) VALUES (4, 3, 2024, 'AED')")
        
        metrics_wio = {
            'total_assets': 37354676, 'total_liabilities': 35148459, 'total_equity': 2206217,
            'total_operating_revenue': 1253619, 'total_operating_expenses': 858636,
            'pat': 394983, 'net_interests': 900304,
            'gross_loan_portfolio': 830000, 'gross_non_performing_loans': 0,
            'total_loan_loss_provisions': 0, 'debts_to_clients': 34800000,
            'debts_to_financial_institutions': 348459,
        }
        for name, val in metrics_wio.items():
            conn.execute(
                "INSERT INTO financial_metrics (statement_id, metric_name, metric_value, is_calculated, data_source) VALUES (4, ?, ?, 0, 'Files Upload')",
                (name, val)
            )
        
        # Seed peer ratings for Emirates NBD
        peer_rating_data = json.dumps({
            "target_company": "Emirates NBD",
            "companies": [
                {"company_name": "Emirates NBD", "pat": 6750000, "total_equity": 17377615, "roe": 38.8, "gross_loan_portfolio": 78888408, "currency": "AED"},
                {"company_name": "Abu Dhabi Islamic Bank PJSC", "pat": 6101417, "total_equity": 28317238, "roe": 21.5, "gross_loan_portfolio": 160000000, "currency": "AED"},
                {"company_name": "Wio Bank PJSC", "pat": 394983, "total_equity": 2206217, "roe": 17.9, "gross_loan_portfolio": 830000, "currency": "AED"}
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
                    {"criterion": "Competitor Positioning", "score": 4.0, "justification": "Second largest bank in UAE"}
                ]
            },
            "overall_scores": {"Emirates NBD": 3.9},
            "summaries": {"Emirates NBD": "Emirates NBD is a strong acquisition target with robust profitability, experienced management, and a leading market position in the UAE."}
        })
        
        conn.execute(
            "INSERT INTO peer_ratings (company_id, result_json) VALUES (1, ?)",
            (peer_rating_data,)
        )
        
        conn.commit()
        logger.info("[DB] Sample data seeded successfully")
