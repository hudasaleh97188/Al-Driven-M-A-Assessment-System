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
    conn.commit()
    conn.close()
    logger.info("Database initialized successfully")

def save_analysis(company_name: str, financial_data: list, anomalies_and_risks: list, currency: str = 'USD'):
    logger.info(f"[SAVE] company_name='{company_name}', currency='{currency}', financial_data_items={len(financial_data)}, risks_items={len(anomalies_and_risks)}")
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT OR REPLACE INTO company_analysis (company_name, currency, financial_data_json, anomalies_and_risks_json)
        VALUES (?, ?, ?, ?)
    ''', (company_name.lower(), currency, json.dumps(financial_data), json.dumps(anomalies_and_risks)))
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
        SELECT currency, financial_data_json, anomalies_and_risks_json
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
            "financial_data": json.loads(row[1]),
            "anomalies_and_risks": json.loads(row[2])
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