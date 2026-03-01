import os
import argparse
import base64
import json
from typing import List, Optional

from google import genai
from google.genai import types

# Define the expected output schema as a Pydantic Model (or dict) to pass to Gemini
response_schema_dict = {
    "type": "OBJECT",
    "properties": {
        "company_name": {"type": "STRING"},
        "currency": {"type": "STRING", "description": "e.g., USDm, EURm"},
        "company_overview": {
            "type": "OBJECT",
            "description": "High-level qualitative information about the company's operations, leadership, and structure.",
            "properties": {
                "description_of_products_and_services": {"type": "STRING"},
                "countries_of_operation": {"type": "ARRAY", "items": {"type": "STRING"}},
                "management_team": {
                    "type": "ARRAY",
                    "description": "Focus strictly on CEO, CFO, CTO, and CRO (or Head of Risk).",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "name": {"type": "STRING"},
                            "position": {"type": "STRING"}
                        },
                        "required": ["name", "position"]
                    }
                },
                "shareholder_structure": {
                    "type": "ARRAY",
                    "description": "Major shareholders and ownership percentage.",
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "name": {"type": "STRING"},
                            "ownership_percentage": {"type": "NUMBER"}
                        },
                        "required": ["name"]
                    }
                },
                "strategic_partners": {
                    "type": "ARRAY",
                    "description": "e.g., World Bank, IFC, EBRD, major tech or financial partners.",
                    "items": {"type": "STRING"}
                }
            }
        },
        "financial_data": {
            "type": "ARRAY",
            "description": "Time-series data, ideal for charting libraries (e.g., Recharts, Chart.js)",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "year": {"type": "INTEGER"},
                    "financial_health": {
                        "type": "OBJECT",
                        "properties": {
                            "revenue": {"type": "NUMBER", "description": "Total Operating Revenue"},
                            "revenue_by_segment_or_geography": {
                                "type": "ARRAY",
                                "description": "If disclosed, breakdown of revenue by business segment or geographic region.",
                                "items": {
                                    "type": "OBJECT",
                                    "properties": {
                                        "segment_name": {"type": "STRING"},
                                        "revenue": {"type": "NUMBER"}
                                    },
                                    "required": ["segment_name", "revenue"]
                                }
                            },
                            "ebitda": {"type": "NUMBER", "description": "Earnings before interest, tax, depreciation and amortisation. Not disclosed, approximated from income statement. Formula: = Net income + Tax on profits + Net interests + Operating allowances"},
                            "pat": {"type": "NUMBER", "description": "Net Income"},
                            "total_assets": {"type": "NUMBER"},
                            "total_operating_expenses": {"type": "NUMBER"},
                            "net_interests": {"type": "NUMBER"},
                            "gross_loan_portfolio": {"type": "NUMBER", "description": "Loans gross outstanding and accrued interest"},
                            "loans_with_arrears_over_30_days": {"type": "NUMBER"},
                            "gross_non_performing_loans": {"type": "NUMBER", "description": "Gross non-performing loans (usually 90+ days past due) or NPL"},
                            "total_loan_loss_provisions": {"type": "NUMBER"},
                            "total_equity": {"type": "NUMBER", "description": "Company's accounting net worth (assets minus liabilities)"},
                            "tier_1_capital": {"type": "NUMBER"},
                            "risk_weighted_assets": {"type": "NUMBER"},
                            "disbursals": {"type": "NUMBER", "description": "Loans disbursed during the year"},
                            "debts_to_clients": {"type": "NUMBER", "description": "Customer deposits"},
                            "debts_to_financial_institutions": {"type": "NUMBER", "description": "Borrowings from financial institutions"},
                            "credit_rating": {"type": "STRING"},
                        },
                    },
                    "operational_scale": {
                        "type": "OBJECT",
                        "description": "Operational footprint and scale indicators",
                        "properties": {
                            "number_of_branches": {"type": "INTEGER", "description": "Total number of physical branches (excluding light sales points/agents)"},
                            "number_of_employees": {"type": "INTEGER", "description": "Total staff headcount at year-end"},
                            "number_of_borrowers": {"type": "INTEGER", "description": "Total number of active customers/borrowers"},
                        },
                    },
                },
                "required": ["year"],
            },
        },
        "anomalies_and_risks": {
            "type": "ARRAY",
            "description": "Combined M&A red flags, financial anomalies, and regulatory compliance checks.",
            "items": {
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
                        "description": "How this specific issue affects the company's valuation (e.g., 'Direct deduction from enterprise value').",
                    },
                    "negotiation_leverage": {
                        "type": "STRING",
                        "description": "How to use this point during M&A negotiations.",
                    },
                },
                "required": [
                    "category",
                    "description",
                    "severity_level",
                    "valuation_impact",
                    "negotiation_leverage",
                ],
            },
        },
    },
    "required": ["company_name", "currency", "company_overview", "financial_data", "anomalies_and_risks"],
}

stage2_schema_dict = {
    "type": "OBJECT",
    "properties": {
        "company_overview": response_schema_dict["properties"]["company_overview"],
        "financial_data": response_schema_dict["properties"]["financial_data"],
        "quality_of_it": {
            "type": "OBJECT",
            "properties": {
                "core_banking_systems": {"type": "ARRAY", "items": {"type": "STRING"}},
                "digital_channel_adoption": {"type": "STRING"},
                "system_upgrades": {"type": "ARRAY", "items": {"type": "STRING"}},
                "vendor_partnerships": {"type": "ARRAY", "items": {"type": "STRING"}},
                "cyber_incidents": {"type": "ARRAY", "items": {"type": "STRING"}}
            }
        }
    },
    "required": ["company_overview", "financial_data", "quality_of_it"]
}

stage3_schema_dict = {
    "type": "OBJECT",
    "properties": {
        "macroeconomic_geo_view": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "country": {"type": "STRING"},
                    "gdp_per_capita_ppp": {"type": "STRING"},
                    "inflation_projection": {"type": "STRING"},
                    "country_risk_score": {"type": "STRING"},
                    "corruption_perceptions_index": {"type": "STRING"},
                    "financial_inclusion_rate": {"type": "STRING"},
                    "credit_to_gdp_ratio": {"type": "STRING"},
                    "mobile_money_adoption": {"type": "STRING"}
                },
                "required": ["country"]
            }
        },
        "competitive_position": {
            "type": "OBJECT",
            "properties": {
                "market_share_data": {"type": "STRING"},
                "central_bank_sector_reports_summary": {"type": "STRING"},
                "industry_studies_summary": {"type": "STRING"},
                "customer_growth_or_attrition_news": {"type": "STRING"}
            }
        },
        "management_quality": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "name": {"type": "STRING"},
                    "position": {"type": "STRING"},
                    "previous_roles_and_exits": {"type": "STRING"},
                    "tenure_history": {"type": "STRING"},
                    "media_interviews_or_controversies": {"type": "STRING"}
                },
                "required": ["name"]
            }
        }
    },
    "required": ["macroeconomic_geo_view", "competitive_position", "management_quality"]
}

def extract_base_pdf(file_paths: List[str], project_id: Optional[str] = None) -> dict:
    """
    Reads multiple PDF reports, sends them to Gemini 3.1 Pro via Vertex AI,
    and returns a structured JSON matching the M&A schema.
    """
    
    # 1. Initialize Client
    if not project_id:
        project_id = "rag-project-485016"
        
    client = genai.Client(vertexai=True, project=project_id, location="global")
    model_id = "gemini-3.1-pro-preview"

    # 2. Build Contents list (Prompt + Files)
    contents = []
    
    # System Instructions/Prompt
    prompt = """
    Role: You are an elite M&A Financial Analyst, Regulatory Compliance Expert, and Due Diligence Specialist evaluating target acquisitions in the Fintech/NBFC/Banking sector. You combine deep domain expertise in credit risk, operational efficiency, regulatory frameworks, and corporate governance.
    
    Task: Perform a comprehensive forensic analysis of the provided Annual Reports. You must determine the Company Name and the Years of data provided. Extract the exact time-series financial and operational metrics requested, and conduct a rigorous, multi-dimensional risk assessment.
    
    === SECTION 1: QUALITATIVE & QUANTITATIVE OVERVIEW ===
    
    Extract values for ALL years present in the reports where applicable. Determine the primary reporting currency (e.g., "EURm", "USDm", "NGNm").

    First, build the `company_overview` (extract this once for the entire organization):
    - Description of products and services
    - Countries of operation (list them)
    - Management team (Focus strictly on extracting names for CEO, CFO, CTO, and CRO/Head of Risk)
    - Shareholder structure (Major shareholders and their ownership percentage)
    - Strategic Partners (e.g., IFIs like World Bank, IFC, EBRD, or major technical/funding partners)
    
    Then, for EACH YEAR, extract the following:
    
    1. Financial Health: 
       - Revenue (Total Operating Revenue)
       - Revenue by segment/geography (Extract the breakdown if disclosed)
       - PAT (Net income)
       - EBITDA (Formula: = Net income + Tax on profits + Net interests + Operating allowances. Please approximate it using this formula).
       - Total Assets
       - Total Operating Expenses
       - Net Interests
       - Gross loan portfolio (Loans gross outstanding and accrued interest)
       - Loans with arrears >30 days
       - Gross non-performing loans (usually 90+ days past due or NPL)
       - Total loan loss provisions
       - Total Equity
       - Tier 1 Capital
       - Risk-Weighted Assets
       - Disbursals (Loans disbursed during the year)
       - Debts to clients (Customer deposits)
       - Debts to financial institutions (Borrowings)
       - Credit Rating
    2. Operational Scale: 
       - Total number of branches (physical branches only, exclude POS or agents)
       - Total Employees/FTEs
       - Total number of customers (Active borrowers)
    
    Some metrics require mathematical operations to be calculated. Use the needed Numbers to calculate the metric. Don't assume any values. If the value is not found or cannot be calculated, return null.
    === SECTION 2: DEEP RISK & ANOMALY ANALYSIS (anomalies_and_risks) ===
    
    This is the most critical section. DO NOT produce surface-level observations. You must synthesize data across multiple years, cross-reference narrative claims with actual figures, and identify hidden risks that a junior analyst would miss.
    
    For each risk you identify, you MUST provide:
    - A precise, specific description with actual numbers and year references (not vague statements)
    - A calibrated severity level (Low/Medium/High/Critical) justified by quantitative thresholds
    - A concrete valuation impact statement (e.g., "-15% Est. EV Adjustment", "+2.5% Discount Rate Adj.", "Higher CAPEX")
    - An actionable negotiation lever that an M&A deal team can directly use
    
    Analyze the following 7 dimensions systematically:
    
    1. FINANCIAL TRAJECTORY ANOMALIES
       - Revenue/profit trend reversals: Is the company transitioning from growth to decline, or profit to loss? Quantify the magnitude.
       - Margin compression: Are operating margins deteriorating faster than revenue? This signals structural cost problems.
       - One-off vs. recurring: Separate extraordinary items (asset sales, write-offs, restructuring charges) from core operating performance. Flag if management is obscuring poor performance behind one-offs.
    
    2. ASSET QUALITY DETERIORATION
       - NPL/GNPA trajectory: Is the ratio worsening? Compare against regulatory thresholds (e.g., 5% NPL ceiling in many jurisdictions).
       - Provision adequacy: Is the provision coverage ratio declining while NPLs rise? This signals under-provisioning risk.
       - PAR > 30 migration: Track the pipeline of loans aging into default. A rising PAR30 with stable NPLs may mean the company is restructuring loans to hide deterioration.
       - Concentration risk: Are loans concentrated in specific geographies, sectors, or a small number of large borrowers?
    
    3. CAPITAL & SOLVENCY RISKS
       - CAR erosion: Is the Capital Adequacy Ratio trending toward regulatory minimums? Quantify the buffer.
       - Equity depletion: Has accumulated FX losses, goodwill impairments, or consecutive losses materially eroded the equity base?
       - Subsidiary-level risk: Do individual subsidiaries breach local CAR or capital requirements even if the group consolidation looks healthy?
    
    4. OPERATIONAL & SCALE RISKS
       - Employee/branch productivity: Calculate revenue-per-employee or loans-per-branch trends. Declining productivity signals operational inefficiency.
       - Rapid expansion without proportionate controls: Fast branch or headcount growth without corresponding revenue growth is a red flag.
       - Technology/IT failures: Look for mentions of failed system migrations, cybersecurity incidents, or technology write-offs buried in notes.
    
    5. REGULATORY & COMPLIANCE
       - Cross-reference all extracted ratios (NPL, CAR, liquidity) against known regulatory minimums for each operating jurisdiction.
       - Look for disclosed regulatory actions, fines, sanctions, or pending investigations.
       - Evaluate anti-money laundering (AML) and know-your-customer (KYC) disclosures for adequacy.
    
    6. GOVERNANCE & RELATED-PARTY RISKS
       - Related-party transactions: Identify material transactions with directors, shareholders, or affiliated entities.
       - Auditor qualifications or emphasis of matter: Any qualified audit opinion is a Critical-severity finding.
       - Management turnover: Frequent C-suite or board changes signal instability.
    
    7. STRATEGIC & MARKET RISKS
       - Geographic/currency concentration: Heavy exposure to volatile currencies or politically unstable regions.
       - Competitive position: Evidence of market share loss, customer attrition, or pricing pressure.
       - Discontinued operations: Material divestitures that fundamentally change the company's risk profile or revenue base.
    
    IMPORTANT: Aim to produce at least 5-8 distinct, well-researched risk items. Each must reference specific data points from the reports. Generic or vague risks are unacceptable.
    
    Output Format: You must output the final result STRICTLY as a valid JSON object adhering to the schema structure requested.
    """
    contents.append(prompt)
    
    # Read Files
    for file_path in file_paths:
        if not os.path.exists(file_path):
            print(f"Warning: File not found at {file_path}. Skipping.")
            continue
            
        with open(file_path, "rb") as f:
            file_bytes = f.read()
            # Wrap raw bytes in a Part
            pdf_part = types.Part.from_bytes(data=file_bytes, mime_type="application/pdf")
            contents.append(pdf_part)

    print(f"Sending {len(file_paths)} files to {model_id} for analysis. This may take a minute...")
    
    # 3. Call Gemini
    response = client.models.generate_content(
        model=model_id,
        contents=contents,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=response_schema_dict,
            # For complex reasoning over multiple large PDFs, allowing thinking works best in Pro
            thinking_config=types.ThinkingConfig(
                thinking_level=types.ThinkingLevel.HIGH 
            ),
            temperature=0 # Keep temperature low for deterministic financial extraction
        ),
    )

    print(f"\n--- RAW LLM OUTPUT ---\n{response.text}\n----------------------\n")

    try:
        data = json.loads(response.text)
        for year_data in data.get("financial_data", []):
            fin_health = year_data.get("financial_health", {})

            # Helper for safe division
            def safe_divide(num, den):
                if num is not None and den is not None and den != 0:
                    return num / den
                return None

            # Calculate Ratios
            pat = fin_health.get("pat")
            revenue = fin_health.get("revenue")
            total_equity = fin_health.get("total_equity")
            total_assets = fin_health.get("total_assets")
            op_expenses = fin_health.get("total_operating_expenses")
            
            pm = safe_divide(pat, revenue)
            if pm is not None: fin_health["profit_margin_percent"] = round(pm * 100, 2)
            
            roe = safe_divide(pat, total_equity)
            if roe is not None: fin_health["roe_percent"] = round(roe * 100, 2)
            
            roa = safe_divide(pat, total_assets)
            if roa is not None: fin_health["roa_percent"] = round(roa * 100, 2)
            
            cost_inc = safe_divide(op_expenses, revenue)
            if cost_inc is not None: fin_health["cost_to_income_ratio_percent"] = round(cost_inc * 100, 2)

            # Loan Book mappings
            net_interests = fin_health.get("net_interests")
            gross_loans = fin_health.get("gross_loan_portfolio")
            arrears_30 = fin_health.get("loans_with_arrears_over_30_days")
            gnpa_val = fin_health.get("gross_non_performing_loans")
            provisions = fin_health.get("total_loan_loss_provisions")
            
            # Map for frontend
            if gross_loans is not None:
                fin_health["total_loan_outstanding"] = gross_loans
            else:
                fin_health["total_loan_outstanding"] = fin_health.get("total_loan_outstanding")
            
            nim = safe_divide(net_interests, gross_loans)
            if nim is not None: fin_health["nim_percent"] = round(nim * 100, 2)
            
            par30 = safe_divide(arrears_30, gross_loans)
            if par30 is not None: fin_health["par_30_percent"] = round(par30 * 100, 2)
            
            gnpa = safe_divide(gnpa_val, gross_loans)
            if gnpa is not None: fin_health["gnpa_percent"] = round(gnpa * 100, 2)
            
            prov_cov = safe_divide(provisions, gross_loans)
            if prov_cov is not None: fin_health["provision_coverage_percent"] = round(prov_cov * 100, 2)

            # Capital & Funding mappings
            tier1 = fin_health.get("tier_1_capital")
            rwa = fin_health.get("risk_weighted_assets")
            debts_clients = fin_health.get("debts_to_clients")
            debts_fi = fin_health.get("debts_to_financial_institutions")
            
            car = safe_divide(tier1, rwa)
            if car is not None: fin_health["car_tier_1_percent"] = round(car * 100, 2)
            
            dep_borr = safe_divide(debts_clients, debts_fi)
            if dep_borr is not None: fin_health["depositors_vs_borrowers_ratio"] = str(round(dep_borr, 2))

            # Store the updated dicts back to make sure changes persist
            year_data["financial_health"] = fin_health

        return data
    except Exception as e:
        print(f"Error computing ratios: {e}")
        try:
            return json.loads(response.text)
        except:
            return {}

def enrich_with_web_and_it(base_data: dict, company_name: str, project_id: Optional[str] = None) -> dict:
    """Stage 2: Use Google Search Grounding to fill missing data and assess IT quality."""
    if not project_id:
        project_id = "rag-project-485016"
    client = genai.Client(vertexai=True, project=project_id, location="global")
    # Use standard 2.5-pro or 3.1-pro with search tools
    model_id = "gemini-3.1-pro-preview" 

    prompt = f'''
    Role: Tech & Data Diligence Expert / Data Completeness Agent for M&A.
    Task: Enrich the provided stage 1 extraction for "{company_name}".
    
    1. MISSING DATA CORRECTION:
    Review the provided JSON. If you see missing fields (like null, -1, or empty arrays) in the financial_data or company_overview, use Google Search to find and fill them (e.g., searching for press releases, news, or LinkedIn). You must return the entirety of the company_overview and financial_data arrays in your response, patching any holes you can find.
    
    2. IT & DATA USAGE DUE DILIGENCE:
    Use Google Search to dive deep into the company's technology stack and digital footprint. Find:
    - Core banking systems used
    - Digital channel adoption rates
    - Press releases on recent system upgrades
    - Vendor partnerships
    - Any disclosed cyber incidents
    
    Current Stage 1 Data to enrich:
    {json.dumps(base_data, indent=2)}
    
    Output strictly as JSON matching the requested schema.
    '''
    
    print(f"--- Running Stage 2 (Web Enrichment & IT) for {company_name} ---")
    response = client.models.generate_content(
        model=model_id,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=stage2_schema_dict,
            tools=[types.Tool(google_search=types.GoogleSearch())],
            temperature=0.2
        ),
    )
    
    try:
        return json.loads(response.text)
    except:
        return {}


def deep_dive_macro_and_management(base_data: dict, company_name: str, project_id: Optional[str] = None) -> dict:
    """Stage 3: Use Google Search Grounding to pull Macroeconomics, Competitive Position, and Management Quality."""
    if not project_id:
        project_id = "rag-project-485016"
    client = genai.Client(vertexai=True, project=project_id, location="global")
    model_id = "gemini-3.1-pro-preview" 
    
    overview = base_data.get("company_overview", {})
    countries = overview.get("countries_of_operation", [])
    management = overview.get("management_team", [])
    
    prompt = f'''
    Role: Macroeconomist & Private Equity Investigator.
    Task: Perform a deep dive using Google Search on "{company_name}" operating in {countries}, with leadership: {json.dumps(management)}.
    
    1. MICROFINANCE GEO-VIEW (Macroeconomics):
    Search for recent macroeconomic indicators for EACH country the company operates in: GDP per capita (PPP), Inflation projections, Country risk scores, Corruption Perceptions Index (CPI), Financial inclusion rates, Credit-to-GDP ratio, and mobile money adoption via external sources like World Bank or IMF.
    
    2. COMPETITIVE POSITION:
    Search for "{company_name}" market share data, references in central bank sector reports, industry studies, and recent news regarding customer growth or attrition.
    
    3. MANAGEMENT QUALITY:
    Deep dive into the extracted management team members. Search LinkedIn and financial news to find their:
    - Previous roles and exits
    - Tenure history
    - Media interviews or any controversies.
    
    Output strictly as JSON matching the requested schema.
    '''
    
    print(f"--- Running Stage 3 (Macro & Management) for {company_name} ---")
    response = client.models.generate_content(
        model=model_id,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=stage3_schema_dict,
            tools=[types.Tool(google_search=types.GoogleSearch())],
            temperature=0.2
        ),
    )
    
    try:
        return json.loads(response.text)
    except:
        return {}


def extract_financials_from_reports(file_paths: List[str], project_id: Optional[str] = None) -> str:
    """
    Orchestrates the 3-stage agentic pipeline.
    """
    # Stage 1: Base PDF Extraction
    base_data = extract_base_pdf(file_paths, project_id)
    company_name = base_data.get("company_name", "Unknown Company")
    
    if not company_name or company_name == "Unknown Company":
        print("Warning: Could not determine company name in Stage 1. Cannot run web searches effectively.")
        return json.dumps(base_data)
        
    # Stage 2: Web Enrichment & IT
    stage2 = enrich_with_web_and_it(base_data, company_name, project_id)
    if stage2:
        base_data["company_overview"] = stage2.get("company_overview", base_data.get("company_overview"))
        base_data["financial_data"] = stage2.get("financial_data", base_data.get("financial_data"))
        base_data["quality_of_it"] = stage2.get("quality_of_it", {})
    
    # Stage 3: Macro & Management Deep Dive
    stage3 = deep_dive_macro_and_management(base_data, company_name, project_id)
    if stage3:
        base_data["macroeconomic_geo_view"] = stage3.get("macroeconomic_geo_view", [])
        base_data["competitive_position"] = stage3.get("competitive_position", {})
        base_data["management_quality"] = stage3.get("management_quality", [])
        
    return json.dumps(base_data)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract M&A Financials from Annual Reports.")
    parser.add_argument(
        "--files", 
        nargs="+", 
        help="List of PDF file paths to process.", 
        required=True
    )

    args = parser.parse_args()
    
    try:
        json_result = extract_financials_from_reports(args.files)
        print("\n--- EXTRACTION RESULT ---")
        print(json_result)
    except Exception as e:
        print(f"An error occurred: {e}")
