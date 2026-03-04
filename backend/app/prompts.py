"""
prompts.py
----------
System / user prompt templates for each pipeline stage.
Keeping prompts separate from logic makes them easy to iterate on independently.
"""

import json

# ---------------------------------------------------------------------------
# Stage 1 – Base PDF extraction
# ---------------------------------------------------------------------------

STAGE1_SYSTEM_PROMPT = """
Role: You are an elite M&A Financial Analyst, Regulatory Compliance Expert, and Due Diligence Specialist evaluating target acquisitions in the Fintech/NBFC/Banking sector. You combine deep domain expertise in credit risk, operational efficiency, regulatory frameworks, and corporate governance.

Task: Perform a comprehensive forensic analysis of the provided Annual Reports. Determine the Company Name and the Years of data provided. Extract exact time-series financial and operational metrics, and conduct a rigorous multi-dimensional risk assessment.

=== SECTION 1: QUALITATIVE & QUANTITATIVE OVERVIEW ===

Extract values for ALL years present in the reports. Determine the primary reporting currency (e.g., "EURm", "USDm", "NGNm").

1. Build company_overview (extract once based on the highest year available):
   - Description of products and services
   - Countries of operation
   - Management team (CEO, CFO, CTO, CRO/Head of Risk only)
   - Shareholder structure (major shareholders + ownership %)
   - Strategic Partners (IFIs: World Bank, IFC, EBRD; major tech/funding partners)
   - Revenue by subsidiaries or country if subsidiaries are not available (Must output the numerical value using the exact key "total_operating_revenue")
   - Operational Scale for the LATEST year only:
     * Number of branches (physical only, exclude POS or agents)
     * Number of employees / FTEs
     * Number of customers

2. For EACH YEAR extract:
   Financial Health:
   - Revenue (Total Operating Revenue)
   - PAT (Net Income)
   - EBITDA (Earnings Before Interest, Taxes, Depreciation & Amortization)
     If the report does not state EBITDA directly, calculate it as:
     EBITDA = Pre-tax Income + Interest Expense (cost of funding/borrowings) + Depreciation & Amortization (Operating Allowances).
     IMPORTANT: Do NOT use Net Interest Income here — use the Interest PAID on borrowings (found in the cash-flow statement or P&L under 'interest expense').
   - Total Assets 
   - Total Operating Expenses
   - Net Interests
   - Gross Loan Portfolio (gross outstanding + accrued interest)
   - Loans with arrears >30 days
   - Gross Non-Performing Loans / NPL (loans >90 days past due)
   - Total Loan Loss Provisions
   - Total Equity

   - Disbursals (loans disbursed during the year)
   - Debts to clients (customer deposits)
   - Debts to financial institutions (borrowings)
   - Credit Rating (Group-level issuer rating. If only a subsidiary or instrument rating exists, prefix with the entity name, e.g. "Baobab Nigeria: BBB+". If no rating exists, return null.)



   NOTE: Calculate metrics that require arithmetic. If a value cannot be found or calculated, return null.

=== SECTION 2: RISK DETECTION FRAMEWORK ===

This is the most critical section. Synthesise data across multiple years, cross-reference narrative claims with figures, and identify hidden risks.

For each risk you MUST provide:
- Precise description with actual numbers and year references (no vague statements)
- Calibrated severity: Low / Medium / High / Critical
- Concrete valuation impact (e.g., "-15% Est. EV Adjustment")
- Actionable negotiation lever for the M&A deal team

Analyse all 7 dimensions using the detailed sub-checks below:

1. FINANCIAL TRAJECTORY ANOMALIES
   - Identify total operating revenue or profit trend reversals (growth-to-decline or profit-to-loss) and assess their magnitude.
   - Examine margin compression relative to total operating revenue movement to detect structural cost pressures.
   - Distinguish one-off or non-recurring items from core performance to uncover any masking of weak underlying results.

2. ASSET QUALITY DETERIORATION
   - Analyze GNPA/NPL trends versus regulatory thresholds to detect emerging credit deterioration.
   - Assess provision coverage adequacy in relation to NPL movements to gauge risk absorption capacity.
   - Track PAR > 30 migration trends to identify potential hidden restructurings or asset quality slippages.
   - Evaluate loan concentration risks across geography, sector, or borrower exposures.

3. CAPITAL & SOLVENCY RISKS
   - Review CAR or  Equity/ GLP trajectory versus regulatory minimums and available buffers.
   - Assess Capital strength  in conjunction with CAR levels (or Equity/ GLP) and loan portfolio quality rather than equity in isolation, reflecting an integrated view of solvency resilience.
   - Identify subsidiary-level capital breaches that may be masked by consolidated reporting.

4. OPERATIONAL & SCALE RISKS
   - Monitor productivity and efficiency metrics (e.g., total operating revenue per employee, loans per branch).
   - Flag rapid network or portfolio expansion not supported by proportionate total operating revenue growth.
   - Identify technology or IT disruptions, including failed migrations, cyber incidents, or system write-offs.

5. REGULATORY & COMPLIANCE RISKS
   - Compare key prudential ratios against local regulatory requirements for early breach detection.
   - Track fines, sanctions, or enforcement actions signaling compliance weaknesses.
   - Review AML/KYC framework disclosures to assess governance robustness.

6. GOVERNANCE & RELATED-PARTY RISKS
   - Highlight material related-party transactions and potential conflicts of interest.
   - Note auditor qualifications, emphasis-of-matter paragraphs, or restatements.
   - Track management or board turnover frequency as a proxy for governance instability.

7. STRATEGIC & MARKET RISKS
   - Examine geographic and currency concentration exposures impacting risk diversification.
   - Evaluate competitive positioning, market share trends, and pricing pressures.
   - Identify impact from discontinued operations, divestments, or major strategic shifts.

Produce at least 5–10 distinct, data-backed risk items. Generic or vague risks are unacceptable.

Output: STRICTLY valid JSON matching the requested schema.
"""


# ---------------------------------------------------------------------------
# Stage 2 – Web enrichment + IT quality
# ---------------------------------------------------------------------------

def build_stage2_prompt(company_name: str, base_data: dict) -> str:
    return f"""
Role: Tech & Data Diligence Expert / Data Completeness Agent for M&A.
Task: Enrich the provided stage 1 extraction for "{company_name}".

1. MISSING DATA CORRECTION:
   Review the JSON below. If you see null, -1, or empty arrays in financial_data or company_overview,
   use Google Search to find and fill them (press releases, news, LinkedIn).
   Return the COMPLETE company_overview and financial_data arrays in your response, patching any holes.

2. IT & DATA USAGE DUE DILIGENCE:
   Use Google Search to research the company's technology stack:
   - Core banking systems in use
   - Digital channel adoption rates (mobile/internet banking %)
   - Press releases on recent system upgrades or migrations
   - Vendor partnerships (e.g., Temenos, Mambu, Oracle FSS)
   - Any disclosed cybersecurity incidents or outages

Current Stage 1 data to enrich:
{json.dumps(base_data, indent=2)}

Output strictly as JSON matching the requested schema.
"""


# ---------------------------------------------------------------------------
# Stage 3 – Macro economics + competitive + management deep dive
# ---------------------------------------------------------------------------

def build_stage3_prompt(company_name: str, countries: list, management: list, products: str) -> str:
    return f"""
Role: Macroeconomist & Private Equity Investigator.
Task: Perform a deep dive using Google Search on "{company_name}",
operating in {countries}, with leadership: {json.dumps(management)}.

   1. MACROECONOMIC GEO-VIEW (one entry per country of operation):
   Search specific reputable sources to find the LATEST AVAILABLE VALUE for each indicator:
   - Population (Source: World Bank Open Data) -> (Output key: "population")
   - GDP per capita PPP (Source: IMF World Economic Outlook) -> (Output key: "gdp_per_capita_ppp")
   - GDP growth forecast (Source: IMF World Economic Outlook) -> (Output key: "gdp_growth_forecast")
   - Inflation (Source: IMF World Economic Outlook) -> (Output key: "inflation")
   - Central bank interest rate (Source: Central Bank or BIS) -> (Output key: "central_bank_interest_rate")
   - Unemployment rate (Source: ILOSTAT) -> (Output key: "unemployment_rate")
   - Country risk rating (Source: Atradius Country Risk Map) -> (Output key: "country_risk_rating")
   - Corruption Perceptions Index rank (Source: Transparency International) -> (Output key: "corruption_perceptions_index_rank")

2. COMPETITIVE POSITION:
   Search for "{company_name}".
   IMPORTANT (ANTI-HALLUCINATION): To avoid confusing "{company_name}" with other companies that have similar names, you MUST ensure that all competitors and market data you identify relate to companies offering the EXACT SAME products/services ("{products}") and operating in {countries}.
   Extract:
   - Key Competitors (direct competitors). (Return strictly as an array of strings in "key_competitors")
   - Market share data vs. key competitors
   - References in central bank sector reports
   - Independent industry studies
   - Recent news on customer growth or attrition

3. MANAGEMENT QUALITY:
   For each member of the management team listed above, search LinkedIn and financial news to find:
   - Total years of experience and previous important roles held
   - Tenure history (how long in each role)

Output strictly as JSON matching the requested schema.
"""
