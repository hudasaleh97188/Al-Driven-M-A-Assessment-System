import sqlite3
import json

conn = sqlite3.connect('deallens.db')
cursor = conn.cursor()
cursor.execute("SELECT company_name, currency, financial_data_json FROM company_analysis WHERE company_name LIKE '%baobab%'")
rows = cursor.fetchall()
for r in rows:
    print(f"Name: {r[0]}, Currency: {r[1]}")
    data = json.loads(r[2])
    print("Data element 2024:")
    for d in data:
        if d.get("year") == 2024:
            print(json.dumps(d, indent=2))
        elif d.get("year") == 2023:
            print(json.dumps(d, indent=2))

conn.close()
