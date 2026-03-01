import sqlite3
import json
from typing import Optional, Dict
from loguru import logger

DB_PATH = "deallens.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS company_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT UNIQUE,
            analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            currency TEXT DEFAULT 'USD',
            financial_data_json TEXT,
            anomalies_and_risks_json TEXT
        )
    ''')
    
    # Run migrations for new columns
    new_columns = [
        "company_overview_json TEXT",
        "quality_of_it_json TEXT",
        "macroeconomic_geo_view_json TEXT",
        "competitive_position_json TEXT",
        "management_quality_json TEXT"
    ]
    for col in new_columns:
        try:
            cursor.execute(f"ALTER TABLE company_analysis ADD COLUMN {col}")
        except sqlite3.OperationalError:
            pass # Column already exists
            
    conn.commit()
    conn.close()
    logger.info("Database initialized successfully with migrations")

def save_analysis(company_name: str, financial_data: list, anomalies_and_risks: list, currency: str = 'USD', company_overview: dict = None, quality_of_it: dict = None, macroeconomic_geo_view: dict = None, competitive_position: dict = None, management_quality: dict = None):
    logger.info(f"[SAVE] company_name='{company_name}', currency='{currency}', financial_data_items={len(financial_data)}, risks_items={len(anomalies_and_risks)}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT OR REPLACE INTO company_analysis (
            company_name, currency, financial_data_json, anomalies_and_risks_json,
            company_overview_json, quality_of_it_json, macroeconomic_geo_view_json,
            competitive_position_json, management_quality_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        company_name.lower(), currency, json.dumps(financial_data), json.dumps(anomalies_and_risks),
        json.dumps(company_overview or {}), json.dumps(quality_of_it or {}), json.dumps(macroeconomic_geo_view or {}),
        json.dumps(competitive_position or {}), json.dumps(management_quality or {})
    ))
    conn.commit()
    
    # Verify what was saved
    cursor.execute('SELECT currency FROM company_analysis WHERE company_name = ?', (company_name.lower(),))
    saved_row = cursor.fetchone()
    logger.info(f"[SAVE] Verified saved currency: '{saved_row[0] if saved_row else 'NOT FOUND'}'")
    
    conn.close()

def get_analysis(company_name: str) -> Optional[Dict]:
    logger.info(f"[GET] Fetching analysis for company_name='{company_name}'")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT currency, financial_data_json, anomalies_and_risks_json,
               company_overview_json, quality_of_it_json, macroeconomic_geo_view_json,
               competitive_position_json, management_quality_json
        FROM company_analysis
        WHERE company_name = ?
    ''', (company_name.lower(),))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        logger.info(f"[GET] Found! Raw currency from DB: '{row[0]}', financial_data_json length: {len(row[1]) if row[1] else 0}")
        result = {
            "company_name": company_name,
            "currency": row[0] or 'USD',
            "financial_data": json.loads(row[1]) if row[1] else [],
            "anomalies_and_risks": json.loads(row[2]) if row[2] else [],
            "company_overview": json.loads(row[3]) if row[3] else {},
            "quality_of_it": json.loads(row[4]) if row[4] else {},
            "macroeconomic_geo_view": json.loads(row[5]) if row[5] else {},
            "competitive_position": json.loads(row[6]) if row[6] else {},
            "management_quality": json.loads(row[7]) if row[7] else {}
        }
        logger.info(f"[GET] Returning currency: '{result['currency']}'")
        return result
    
    logger.warning(f"[GET] No record found for '{company_name}'")
    return None

def get_all_analyses():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT company_name, analyzed_at
        FROM company_analysis
        ORDER BY analyzed_at DESC
    ''')
    rows = cursor.fetchall()
    conn.close()
    
    return [{"company_name": r[0], "analyzed_at": r[1]} for r in rows]

if __name__ == "__main__":
    init_db()