from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import tempfile
import json
from loguru import logger
from database import init_db, save_analysis, get_analysis, get_all_analyses
from annual_report_extractor import extract_financials_from_reports
import sys

# Configure Loguru
logger.remove() # Remove default console handler if needed
logger.add(sys.stdout, level="INFO") # Re-add console handler

# Ensure logs directory exists
if not os.path.exists("logs"):
    os.makedirs("logs")

# Add daily rolling log file
logger.add("logs/deal_lens_{time:YYYY-MM-DD}.log", rotation="00:00", retention="30 days", level="INFO")

app = FastAPI(title="DealLens Analysis API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup_event():
    init_db()

@app.post("/api/analyze")
async def analyze_company(
    company_name: str = Form(...),
    files: list[UploadFile] = File(...),
    force: bool = Form(False)
):
    logger.info(f"[ANALYZE] Request received: company_name='{company_name}', files={len(files)}, force={force}")
    
    # Check if we already have it (unless force re-analyze is requested)
    if not force:
        existing = get_analysis(company_name)
        if existing:
            logger.info(f"[ANALYZE] Returning cached result. Currency in cached: '{existing.get('currency')}'")
            return existing
        
    temp_dir = tempfile.mkdtemp()
    file_paths = []
    
    try:
        for file in files:
            temp_path = os.path.join(temp_dir, file.filename)
            with open(temp_path, "wb") as f:
                f.write(await file.read())
            file_paths.append(temp_path)
            
        # Call the extractor
        try:
            result_json_str = extract_financials_from_reports(file_paths)
            logger.info(f"[ANALYZE] Raw LLM output: {result_json_str}")
            result_data = json.loads(result_json_str)
            logger.info(f"[ANALYZE] Parsed JSON keys: {list(result_data.keys())}")
            logger.info(f"[ANALYZE] Parsed currency from LLM: '{result_data.get('currency', 'KEY NOT FOUND')}'")
        except Exception as e:
            logger.error(f"[ANALYZE] LLM Extraction failed: {str(e)}")
            raise HTTPException(status_code=500, detail=f"LLM Extraction failed: {str(e)}")
            
        # Extract necessary parts
        financial_data = result_data.get("financial_data", [])
        anomalies_and_risks = result_data.get("anomalies_and_risks", [])
        currency = result_data.get("currency", "USD")
        company_overview = result_data.get("company_overview", {})
        quality_of_it = result_data.get("quality_of_it", {})
        macroeconomic_geo_view = result_data.get("macroeconomic_geo_view", {})
        competitive_position = result_data.get("competitive_position", {})
        management_quality = result_data.get("management_quality", {})
        
        logger.info(f"[ANALYZE] Extracted: currency='{currency}', financial_data_items={len(financial_data)}, risks_items={len(anomalies_and_risks)}")
        
        # Save to DB (INSERT OR REPLACE will overwrite existing records)
        save_analysis(company_name, financial_data, anomalies_and_risks, currency, 
                      company_overview, quality_of_it, macroeconomic_geo_view, 
                      competitive_position, management_quality)
        
        response = {
            "company_name": company_name,
            "currency": currency,
            "financial_data": financial_data,
            "anomalies_and_risks": anomalies_and_risks,
            "company_overview": company_overview,
            "quality_of_it": quality_of_it,
            "macroeconomic_geo_view": macroeconomic_geo_view,
            "competitive_position": competitive_position,
            "management_quality": management_quality
        }
        logger.info(f"[ANALYZE] Returning response with currency='{response['currency']}'")
        return response
    finally:
        for path in file_paths:
            if os.path.exists(path):
                os.remove(path)
        os.rmdir(temp_dir)

@app.get("/api/analysis/{company_name}")
def get_company_analysis(company_name: str):
    data = get_analysis(company_name)
    if not data:
        raise HTTPException(status_code=404, detail="Company not found")
    return data

@app.get("/api/analyses")
def list_all_analyses():
    return get_all_analyses()

@app.delete("/api/analysis/{company_name}")
def delete_company_analysis(company_name: str):
    """Delete a company analysis so it can be re-analyzed with correct data."""
    from database import delete_analysis
    deleted = delete_analysis(company_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Company not found")
    return {"message": f"Analysis for '{company_name}' deleted successfully"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5050, reload=True)
