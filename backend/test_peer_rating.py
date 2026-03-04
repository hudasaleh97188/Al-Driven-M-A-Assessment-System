"""
test_peer_rating.py
-------------------
Standalone test for the peer rating pipeline.
Uses sample Baobab Group analysis data with known competitors.

Usage:
    cd backend
    python test_peer_rating.py
"""

import json
import sys
import traceback

sys.path.insert(0, ".")

from app.peer_rating import run_peer_rating


# ── Sample analysis data (mimicking a full analysis result) ────────────────

SAMPLE_ANALYSIS = {
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
                "gross_loan_portfolio": 1800,
            },
        }
    ],
    "quality_of_it": {
        "core_banking_systems": ["Temenos T24"],
        "digital_channel_adoption": "Mobile banking used by ~40% of clients",
        "system_upgrades": ["Cloud migration 2022", "New mobile app 2023"],
        "vendor_partnerships": ["Temenos", "Huawei"],
        "cybersecurity_incidents": [],
    },
    "competitive_position": {
        "key_competitors": [
            "FINCA International",
            "Advans Group",
        ],
        "market_share_data": "Leading microfinance provider in West Africa",
        "industry_studies_summary": "Top 3 in microfinance lending in West Africa by GLP",
        "central_bank_sector_reports_summary": "Strong growth in microfinance sector across West Africa",
    },
    "management_quality": [
        {
            "name": "Arnaud Ventura",
            "previous_experience": "Founded Baobab (formerly MicroCred) in 2005, former consultant at BCG",
        },
        {
            "name": "Alix Perrin",
            "previous_experience": "Former VP Finance at Société Générale",
        },
    ],
    "currency": "EURm",
}

# Sample peer analysis for FINCA
SAMPLE_PEER = {
    "company_name": "FINCA International",
    "company_overview": {
        "countries_of_operation": ["Uganda", "Tanzania", "Ecuador", "Afghanistan"],
        "description_of_products_and_services": "Microfinance, SME lending, mobile money",
        "management_team": [
            {"name": "John Hatch", "position": "Founder"},
            {"name": "Andree Simon", "position": "CEO"},
        ],
        "shareholder_structure": [
            {"name": "FINCA Impact Finance", "ownership_percentage": 100},
        ],
        "strategic_partners": ["IFC", "OPIC"],
        "operational_scale": {"number_of_borrowers": 600000, "number_of_branches": 80},
    },
    "financial_data": [
        {
            "year": 2023,
            "financial_health": {
                "pat": 15,
                "total_equity": 200,
                "gross_loan_portfolio": 900,
            },
        }
    ],
    "quality_of_it": {
        "core_banking_systems": ["Temenos"],
        "digital_channel_adoption": "Mobile banking available in most markets",
        "system_upgrades": ["Core banking upgrade 2022"],
    },
    "competitive_position": {
        "key_competitors": ["Baobab Group", "Advans Group"],
        "market_share_data": "Top 5 microfinance globally",
        "industry_studies_summary": "Strong presence in East Africa",
    },
    "management_quality": [
        {"name": "Andree Simon", "previous_experience": "Former executive at TIAA-CREF"},
    ],
    "currency": "USDm",
}


def main():
    company = SAMPLE_ANALYSIS["company_name"]
    peers = [SAMPLE_PEER["company_name"]]

    print(f"\n{'='*60}")
    print(f"  Testing Peer Rating Pipeline")
    print(f"  Target: {company}")
    print(f"  Peers: {peers}")
    print(f"  Scoring: 1–5 scale (deterministic + single LLM call)")
    print(f"{'='*60}\n")

    try:
        result = run_peer_rating(SAMPLE_ANALYSIS, [SAMPLE_PEER])

        if result.get("error"):
            print(f"\n⚠️  Pipeline returned with error: {result['error']}\n")
        else:
            print(f"\n✅ Peer Rating Pipeline SUCCEEDED!\n")

        # Print summary
        print(f"  Companies collected: {len(result.get('companies', []))}")
        for c in result.get("companies", []):
            print(f"    - {c['company_name']}: PAT={c.get('pat')}, ROE={c.get('roe')}")

        print(f"\n  Overall Scores (1–5):")
        for name, score in result.get("overall_scores", {}).items():
            print(f"    - {name}: {score}/5")

        print(f"\n  Detailed Scores:")
        for name, scores in result.get("scores", {}).items():
            print(f"\n    {name}:")
            for s in scores:
                just = f" — {s.get('justification')}" if s.get("justification") else ""
                print(f"      {s['criterion']}: {s['score']}/5{just}")

        # Save full result to file
        with open("test_peer_rating_output.json", "w") as f:
            json.dump(result, f, indent=2)
        print(f"\n  Full result saved to: test_peer_rating_output.json")

    except Exception:
        print(f"\n❌ Peer Rating Pipeline FAILED!\n")
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
