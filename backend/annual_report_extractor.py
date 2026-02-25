import os
import argparse
import base64
from typing import List, Optional

from google import genai
from google.genai import types

# Define the expected output schema as a Pydantic Model (or dict) to pass to Gemini
response_schema_dict = {
    "type": "OBJECT",
    "properties": {
        "company_name": {"type": "STRING"},
        "currency": {"type": "STRING", "description": "e.g., USDm, EURm"},
        "financial_data": {
            "type": "ARRAY",
            "description": "Time-series data, ideal for charting libraries (e.g., Recharts, Chart.js)",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "year": {"type": "INTEGER"},
                    "general_financials": {
                        "type": "OBJECT",
                        "properties": {
                            "revenue": {"type": "NUMBER"},
                            "ebitda": {"type": "NUMBER"},
                            "profit_margin_percent": {"type": "NUMBER"},
                            "pat": {"type": "NUMBER", "description": "Net Income / Profit After Tax"},
                            "roe_percent": {"type": "NUMBER"},
                            "roa_percent": {"type": "NUMBER"},
                            "cost_to_income_ratio_percent": {"type": "NUMBER"},
                        },
                    },
                    "loan_book": {
                        "type": "OBJECT",
                        "properties": {
                            "gnpa_percent": {"type": "NUMBER", "description": "Gross Non-Performing Assets"},
                            "npl_ratio_percent": {"type": "NUMBER"},
                            "provision_coverage_percent": {"type": "NUMBER", "description": "Coverage for bad debt"},
                            "par_30_percent": {"type": "NUMBER"},
                            "total_loan_outstanding": {"type": "NUMBER"},
                            "nim_percent": {"type": "NUMBER", "description": "Net Interest Margin"},
                            "aum": {"type": "NUMBER", "description": "Assets Under Management in reporting currency"},
                        },
                    },
                    "capital_and_funding": {
                        "type": "OBJECT",
                        "properties": {
                            "car_tier_1_percent": {"type": "NUMBER", "description": "Capital Adequacy Ratio"},
                            "total_equity": {"type": "NUMBER"},
                            "disbursals": {"type": "NUMBER"},
                            "depositors_vs_borrowers_ratio": {"type": "STRING"},
                            "credit_rating": {"type": "STRING"},
                        },
                    },
                    "operational_scale": {
                        "type": "OBJECT",
                        "description": "Operational footprint and scale indicators",
                        "properties": {
                            "number_of_branches": {"type": "INTEGER", "description": "Total branch/office count"},
                            "number_of_employees": {"type": "INTEGER", "description": "Total headcount / FTEs"},
                            "number_of_borrowers": {"type": "INTEGER", "description": "Active borrower/customer count"},
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
    "required": ["company_name", "currency", "financial_data", "anomalies_and_risks"],
}


def extract_financials_from_reports(file_paths: List[str], project_id: Optional[str] = None) -> str:
    """
    Reads multiple PDF reports, sends them to Gemini 3.1 Pro via Vertex AI,
    and returns a structured JSON matching the M&A schema.
    """
    
    # 1. Initialize Client
    if not project_id:
        project_id = "rag-project-485016"
        
    client = genai.Client(vertexai=True, project=project_id, location="global")
    model_id = "gemini-3-pro-preview"

    # 2. Build Contents list (Prompt + Files)
    contents = []
    
    # System Instructions/Prompt
    prompt = """
    Role: You are an elite M&A Financial Analyst, Regulatory Compliance Expert, and Due Diligence Specialist evaluating target acquisitions in the Fintech/NBFC/Banking sector. You combine deep domain expertise in credit risk, operational efficiency, regulatory frameworks, and corporate governance.
    
    Task: Perform a comprehensive forensic analysis of the provided Annual Reports. You must determine the Company Name and the Years of data provided. Extract the exact time-series financial and operational metrics requested, and conduct a rigorous, multi-dimensional risk assessment.
    
    === SECTION 1: METRIC EXTRACTION (financial_data) ===
    
    Extract values for ALL years present in the reports. Determine the primary reporting currency (e.g., "EURm", "USDm", "NGNm").
    
    1. General Financials: Revenue, EBITDA, PAT (Net Income), ROE, ROA, Profit Margin, and Cost-to-Income Ratio.
    2. Loan Book: GNPA %, NPL ratio %, PAR > 30 %, Total Loan Outstanding, NIM %, and Provision Coverage %.
    3. Capital & Funding: CAR (Tier 1) %, Total Equity, Disbursals, Depositors vs. Borrowers Ratio, and Credit Ratings.
    4. Operational Scale: Number of Branches/Offices, Total Employees/FTEs, Active Borrowers/Customers, and AUM (Assets Under Management). Extract these for each year if available; look in operational highlights, management discussion sections, and key statistics tables.
    
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

    return response.text

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
