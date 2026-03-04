"""
test_stage3.py
--------------
Standalone test for Stage 3 (deep_dive_macro_and_management).
Uses sample Baobab Group data to test the Gemini call in isolation.

Usage:
    cd backend
    python test_stage3.py
"""

import json
import sys
import traceback

# Ensure app package is importable
sys.path.insert(0, ".")

from app.extractor import deep_dive_macro_and_management


# ── Sample base_data (mimicking what Stages 1+2 produce) ──────────────────

SAMPLE_BASE_DATA = {
    "company_name": "Baobab Group",
    "company_overview": {
        "full_name": "Baobab Group S.A.",
        "year_of_incorporation": "2005",
        "headquarter_country": "France",
        "countries_of_operation": [
            "Senegal", "Mali", "Ivory Coast", "Burkina Faso",
            "Madagascar", "Nigeria", "Democratic Republic of Congo",
            "Tunisia", "China",
        ],
        "description_of_products_and_services": (
            "Microfinance, digital financial services, micro-lending, "
            "savings, insurance, mobile banking, SME lending"
        ),
        "management_team": [
            {"name": "Arnaud Ventura", "position": "CEO"},
            {"name": "Alix Perrin", "position": "CFO"},
        ],
        "shareholder_structure": [
            {"name": "Norfund", "ownership_percentage": 20},
            {"name": "EIB", "ownership_percentage": 15},
            {"name": "ProParco", "ownership_percentage": 12},
        ],
        "strategic_partners": ["IFC", "EIB", "Norfund", "ProParco"],
        "operational_scale": {
            "number_of_borrowers": 1200000,
            "number_of_branches": 170,
        },
    },
    "financial_data": [
        {
            "year": 2023,
            "financial_health": {
                "pat": 42,
                "total_equity": 380,
                "total_assets": 2100,
                "gross_loan_portfolio": 1800,
            },
        }
    ],
}


def main():
    company_name = SAMPLE_BASE_DATA["company_name"]
    print(f"\n{'='*60}")
    print(f"  Testing Stage 3 for: {company_name}")
    print(f"  Model: gemini-3-pro-preview")
    print(f"  Schema + Google Search in single call")
    print(f"{'='*60}\n")

    try:
        result = deep_dive_macro_and_management(
            base_data=SAMPLE_BASE_DATA,
            company_name=company_name,
        )
        print("\n✅ Stage 3 SUCCEEDED!\n")
        print(json.dumps(result, indent=2)[:3000])
        print(f"\n... (total {len(json.dumps(result))} chars)")
    except Exception as exc:
        print(f"\n❌ Stage 3 FAILED!\n")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
