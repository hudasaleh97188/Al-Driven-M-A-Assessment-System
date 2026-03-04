import json
from app.database import get_all_analyses, get_latest_analysis, init_db

# Make sure DB is initialized with country scores
init_db()

analyses = get_all_analyses()
if not analyses:
    print("No analyses found")
    exit(1)

c_name = analyses[0]["company_name"]
print(f"Testing on: {c_name}")
data = get_latest_analysis(c_name)

geo_view = data.get("macroeconomic_geo_view", [])
countries = [g.get("country", "") for g in geo_view if g.get("country")]
print(f"Countries from data: {countries}")

from app.peer_rating_scorer import score_geographic_fit

result = score_geographic_fit([data])
print(json.dumps(result, indent=2))
