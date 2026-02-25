import sqlite3
import json

conn = sqlite3.connect('deallens.db')
cursor = conn.cursor()

# Schema
cursor.execute('PRAGMA table_info(company_analysis)')
schema = cursor.fetchall()
print("SCHEMA:")
for r in schema:
    print(f"  col {r[0]}: {r[1]} ({r[2]}) default={r[4]}")

# All raw data  
cursor.execute('SELECT * FROM company_analysis')
rows = cursor.fetchall()
print(f"\nTOTAL RECORDS: {len(rows)}")

for row in rows:
    print(f"\n--- Record ---")
    for i, val in enumerate(row):
        col_name = schema[i][1] if i < len(schema) else f"col{i}"
        val_str = str(val)
        if len(val_str) > 100:
            val_str = val_str[:100] + "..."
        print(f"  [{i}] {col_name} = {val_str}")

conn.close()
