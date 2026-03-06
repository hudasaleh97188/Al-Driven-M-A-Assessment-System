"""
peer_rating_prompts.py
----------------------
Prompt templates for LLM-based scoring of M&A criteria.
Single-call scoring prompt with all 5 LLM-evaluated rubrics.
"""

import json


# ---------------------------------------------------------------------------
# Rubrics for LLM-evaluated criteria (5 criteria, single call)
# ---------------------------------------------------------------------------

_PRODUCT_MARKET_RUBRIC = """
**Product / Market Strategy Fit**
- 5: Clear focus on Lending (MSME, Retail, Corporate) and Microfinance.
- 3: Deposits and payments products only.
- 1: Niche products with limited scalability or heavy reliance on unsecured retail microloans.
Use fields: products_and_services, countries_of_operation.
"""

_MANAGEMENT_QUALITY_RUBRIC = """
**Quality & Depth of Management**
- 5: Deep institutional experience (e.g., former Top-tier Bank/Consulting execs).
- 3: Solid domestic or regional experience.
- 2: Limited track record or thin C-suite presence.
Use fields: management_team.
"""

_STRATEGIC_PARTNERS_RUBRIC = """
**Strategic Partners**
- 5: Backed by major international DFIs (IFC, EIB, Proparco, Norfund).
- 4: Backed by reliable regional players or local government.
- 3: Local commercial banks, unknown entities, or no strategic partners.
Use fields: strategic_partners.
"""

_IT_QUALITY_RUBRIC = """
**Quality of IT & Data**
- 5: Modern Core Banking Systems (Temenos, Mambu), Cloud-native, high digital adoption.
- 3: Legacy systems with recent upgrades.
- 1: Outdated legacy systems or lack of digital data.
Use fields: it_details.
"""

_COMPETITOR_POSITIONING_RUBRIC = """
**Competitor Positioning**
- 5: Top 1–3 in at least 2 markets.
- 4: Top 1–3 in at least 1 market.
- 3: Top 4–6 in at least 2 markets.
- 1: Otherwise.
Use fields: competitive_position, gross_loan_portfolio, countries_of_operation.
"""

ALL_RUBRICS = f"""
{_PRODUCT_MARKET_RUBRIC}
{_MANAGEMENT_QUALITY_RUBRIC}
{_STRATEGIC_PARTNERS_RUBRIC}
{_IT_QUALITY_RUBRIC}
{_COMPETITOR_POSITIONING_RUBRIC}
"""

LLM_CRITERION_NAMES = [
    "Product / Market Strategy Fit",
    "Quality & Depth of Management",
    "Strategic Partners",
    "Quality of IT & Data",
    "Competitor Positioning",
]


def build_all_criteria_scoring_prompt(all_companies_data: list[dict]) -> str:
    """
    Build a single prompt that asks the LLM to score ALL companies
    on ALL 5 LLM-evaluated criteria at once.
    """
    companies_summary = json.dumps(all_companies_data, indent=2)

    criteria_list = "\n".join(f"  - {name}" for name in LLM_CRITERION_NAMES)

    return f"""
Role: M&A Strategy Scoring Expert.

Task: Score each company below on the following 5 criteria. Each criterion has a
rubric specifying what data fields to use — only use the indicated fields for each.

CRITERIA AND RUBRICS:
{ALL_RUBRICS}

COMPANIES DATA:
{companies_summary}

For EACH company, you must provide:
1. Converted financial values in USD millions (pat_usdm, total_equity_usdm, gross_loan_portfolio_usdm)
   - Read the company's "currency". If it is not USD/USDm, apply an approximate exchange rate conversion to USD millions. If already USDm, just pass the values through.
2. Score ALL of these criteria:
{criteria_list}

For each criterion per company provide:
1. The criterion name (exactly as listed above)
2. A score from 1 to 5 (integer)
3. A one-sentence justification

Output strictly as JSON matching the requested schema.
"""
