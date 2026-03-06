"""
schemas.py
----------
Gemini structured-output schemas for all three pipeline stages.

Stage 1 – Base PDF extraction  (STAGE1_SCHEMA)
Stage 2 – Web enrichment + IT  (STAGE2_SCHEMA)
Stage 3 – Macro + Management   (STAGE3_SCHEMA)
"""

# ---------------------------------------------------------------------------
# Shared sub-schemas (reused across stages)
# ---------------------------------------------------------------------------

_MANAGEMENT_TEAM_ITEM = {
    "type": "OBJECT",
    "properties": {
        "name":     {"type": "STRING"},
        "position": {"type": "STRING"},
    },
    "required": ["name", "position"],
}

_SHAREHOLDER_ITEM = {
    "type": "OBJECT",
    "properties": {
        "name":                 {"type": "STRING"},
        "ownership_percentage": {"type": "NUMBER"},
    },
    "required": ["name"],
}

COMPANY_OVERVIEW_SCHEMA = {
    "type": "OBJECT",
    "description": "High-level qualitative information about the company's operations, leadership, and structure.",
    "properties": {
        "description_of_products_and_services": {"type": "STRING"},
        "countries_of_operation": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
        },
        "management_team": {
            "type": "ARRAY",
            "description": "Focus strictly on CEO, CFO, CTO, and CRO (or Head of Risk).",
            "items": _MANAGEMENT_TEAM_ITEM,
        },
        "shareholder_structure": {
            "type": "ARRAY",
            "description": "Major shareholders and ownership percentage.",
            "items": _SHAREHOLDER_ITEM,
        },
        "strategic_partners": {
            "type": "ARRAY",
            "description": "e.g., World Bank, IFC, EBRD, major tech or financial partners.",
            "items": {"type": "STRING"},
        },
        "revenue_by_subsidiaries_or_country": {
            "type": "ARRAY",
            "description": "Revenue breakdown by subsidiaries or country if subsidiaries are not available (latest available year).",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "subsidiary_or_country": {"type": "STRING"},
                    "total_operating_revenue": {"type": "NUMBER"},
                },
                "required": ["subsidiary_or_country", "total_operating_revenue"],
            },
        },
        "operational_scale": {
            "type": "OBJECT",
            "description": "Operational footprint and scale indicators (latest available year)",
            "properties": {
                "number_of_branches": {
                    "type": "INTEGER",
                    "description": "Total number of physical branches (excluding light sales points/agents)",
                },
                "number_of_employees": {
                    "type": "INTEGER",
                    "description": "Total staff headcount at year-end",
                },
                "number_of_customers": {
                    "type": "INTEGER",
                    "description": "Total number of active customers",
                },
            },
        },
    },
    "required": [
        "description_of_products_and_services",
        "countries_of_operation",
        "management_team",
        "shareholder_structure",
        "strategic_partners",
        "revenue_by_subsidiaries_or_country",
        "operational_scale"
    ],
}

_FINANCIAL_DATA_ITEM = {
    "type": "OBJECT",
    "properties": {
        "year": {"type": "INTEGER"},
        "financial_health": {
            "type": "OBJECT",
            "properties": {
                "total_operating_revenue": {
                    "type": "NUMBER",
                    "description": "Total Operating Revenue",
                },
                "ebitda": {
                    "type": "NUMBER",
                    "description": (
                        "Earnings Before Interest, Taxes, Depreciation & Amortization. "
                        "If not directly stated, calculate as: Pre-tax Income + Interest Expense "
                        "(cost of funding/borrowings) + Depreciation & Amortization. "
                        "Do NOT use Net Interest Income — use Interest PAID on borrowings."
                    ),
                },
                "pat":   {"type": "NUMBER", "description": "Net Income"},
                "total_assets": {"type": "NUMBER"},
                "total_operating_expenses": {"type": "NUMBER"},
                "net_interests": {"type": "NUMBER"},
                "gross_loan_portfolio": {
                    "type": "NUMBER",
                    "description": "Loans gross outstanding and accrued interest",
                },
                "loans_with_arrears_over_30_days": {"type": "NUMBER"},
                "gross_non_performing_loans": {
                    "type": "NUMBER",
                    "description": "Gross Non-Performing Loans / NPL (loans >90 days past due)",
                },
                "total_loan_loss_provisions": {"type": "NUMBER"},
                "total_equity": {
                    "type": "NUMBER",
                    "description": "Company's accounting net worth (assets minus liabilities)",
                },

                "disbursals": {
                    "type": "NUMBER",
                    "description": "Loans disbursed during the year",
                },
                "debts_to_clients": {
                    "type": "NUMBER",
                    "description": "Customer deposits",
                },
                "debts_to_financial_institutions": {
                    "type": "NUMBER",
                    "description": "Borrowings from financial institutions",
                },
                "credit_rating": {
                    "type": "STRING",
                    "description": (
                        "Group-level issuer credit rating. If only a subsidiary or instrument "
                        "rating exists, prefix with entity name (e.g. 'Baobab Nigeria: BBB+'). "
                        "Return null if none."
                    ),
                },
            },
        },
    },
    "required": ["year"],
}

_ANOMALY_ITEM = {
    "type": "OBJECT",
    "properties": {
        "category": {
            "type": "STRING",
            "description": "e.g., 'Regulatory Compliance', 'Financial Anomaly', 'Operational Risk'",
        },
        "description": {
            "type": "STRING",
            "description": "Details of the anomaly or the specific regulatory breach.",
        },
        "severity_level": {
            "type": "STRING",
            "description": "Low, Medium, High, or Critical",
        },
        "valuation_impact": {
            "type": "STRING",
            "description": "How this specific issue affects the company's valuation.",
        },
        "negotiation_leverage": {
            "type": "STRING",
            "description": "How to use this point during M&A negotiations.",
        },
    },
    "required": ["category", "description", "severity_level", "valuation_impact", "negotiation_leverage"],
}

# ---------------------------------------------------------------------------
# Stage 1 – Base PDF extraction
# ---------------------------------------------------------------------------

STAGE1_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "company_name": {"type": "STRING"},
        "currency": {
            "type": "STRING",
            "description": "e.g., USDm, EURm",
        },
        "company_overview": COMPANY_OVERVIEW_SCHEMA,
        "financial_data": {
            "type": "ARRAY",
            "description": "Time-series data, one entry per year.",
            "items": _FINANCIAL_DATA_ITEM,
        },
        "anomalies_and_risks": {
            "type": "ARRAY",
            "description": "Combined M&A red flags, financial anomalies, and regulatory compliance checks.",
            "items": _ANOMALY_ITEM,
        },
    },
    "required": ["company_name", "currency", "company_overview", "financial_data", "anomalies_and_risks"],
}

# ---------------------------------------------------------------------------
# Stage 2 – Web enrichment + IT quality
# ---------------------------------------------------------------------------

STAGE2_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "company_overview": COMPANY_OVERVIEW_SCHEMA,
        "financial_data": {
            "type": "ARRAY",
            "items": _FINANCIAL_DATA_ITEM,
        },
        "is_publicly_listed": {
            "type": "BOOLEAN",
            "description": (
                "True if the company is listed on a stock exchange, "
                "False if it is privately held."
            ),
        },
        "quality_of_it": {
            "type": "OBJECT",
            "properties": {
                "core_banking_systems":   {"type": "ARRAY", "items": {"type": "STRING"}},
                "digital_channel_adoption": {"type": "STRING"},
                "system_upgrades":        {"type": "ARRAY", "items": {"type": "STRING"}},
                "vendor_partnerships":    {"type": "ARRAY", "items": {"type": "STRING"}},
                "cyber_incidents":        {"type": "ARRAY", "items": {"type": "STRING"}},
            },
        },
    },
    "required": ["company_overview", "financial_data", "is_publicly_listed", "quality_of_it"],
}

# ---------------------------------------------------------------------------
# Stage 3 – Macro economics + competitive + management deep dive
# ---------------------------------------------------------------------------

STAGE3_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "macroeconomic_geo_view": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "country":                           {"type": "STRING"},
                    "population":                        {"type": "STRING"},
                    "gdp_per_capita_ppp":                {"type": "STRING"},
                    "gdp_growth_forecast":               {"type": "STRING"},
                    "inflation":                         {"type": "STRING"},
                    "central_bank_interest_rate":        {"type": "STRING"},
                    "unemployment_rate":                 {"type": "STRING"},
                    "country_risk_rating":               {"type": "STRING"},
                    "corruption_perceptions_index_rank": {"type": "STRING"},
                },
                "required": [
                    "country",
                    "population",
                    "gdp_per_capita_ppp",
                    "gdp_growth_forecast",
                    "inflation",
                    "central_bank_interest_rate",
                    "unemployment_rate",
                    "country_risk_rating",
                    "corruption_perceptions_index_rank"
                ],
            },
        },
        "competitive_position": {
            "type": "OBJECT",
            "properties": {
                "key_competitors": {
                    "type": "ARRAY",
                    "description": "Direct competitors offering exact same products/services and operating in the same or similar regions.",
                    "items": {"type": "STRING"},
                },
                "market_share_data":                    {"type": "STRING"},
                "central_bank_sector_reports_summary":  {"type": "STRING"},
                "industry_studies_summary":             {"type": "STRING"},
                "customer_growth_or_attrition_news":    {"type": "STRING"},
            },
            "required": [
                "key_competitors",
                "market_share_data",
                "central_bank_sector_reports_summary",
                "industry_studies_summary",
                "customer_growth_or_attrition_news"
            ],
        },
        "management_quality": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name":                  {"type": "STRING"},
                    "position":              {"type": "STRING"},
                    "previous_experience":   {
                        "type": "STRING",
                        "description": "Total years of experience and previous important roles held.",
                    },
                    "tenure_history":        {"type": "STRING"},
                },
                "required": ["name"],
            },
        },
    },
    "required": ["macroeconomic_geo_view", "competitive_position", "management_quality"],
}
