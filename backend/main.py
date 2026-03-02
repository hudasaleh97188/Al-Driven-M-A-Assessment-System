"""
main.py
-------
FastAPI entry point for the DealLens Analysis API.

Endpoints
─────────
POST   /api/analyze                Upload PDFs + company name → run pipeline
GET    /api/analysis/{company}     Get latest completed analysis
GET    /api/analyses               List all companies with timestamps
DELETE /api/analysis/{company}     Delete a company and all its runs
"""

import json
import os
import tempfile
import traceback

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

# ── Bootstrap logging before anything else ──────────────────────────────────
from app.logging_config import setup_logging

setup_logging()

# ── Application imports ─────────────────────────────────────────────────────
from app.config import SERVER_HOST, SERVER_PORT
from app.database import (
    create_run,
    delete_company,
    get_all_analyses,
    get_latest_analysis,
    init_db,
    update_run,
    upsert_company,
)
from app.extractor import run_pipeline
from app.ratios import enrich_financial_data

# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------

app = FastAPI(
    title="DealLens Analysis API",
    description="AI-Driven M&A Due Diligence – 3-stage Gemini extraction pipeline",
    version="2.0.0",
)

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
    logger.info("DealLens API started – listening on {}:{}", SERVER_HOST, SERVER_PORT)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/analyze")
async def analyze_company(
    company_name: str = Form(...),
    files: list[UploadFile] = File(...),
    force: bool = Form(False),
):
    """
    Upload one or more PDF annual reports and run the 3-stage extraction pipeline.
    If a completed analysis already exists and ``force`` is False, returns the cached result.
    """
    logger.info("[API] POST /api/analyze – company='{}', files={}, force={}", company_name, len(files), force)

    # Return cached result unless force re-analyze is requested
    if not force:
        existing = get_latest_analysis(company_name)
        if existing:
            logger.info("[API] Returning cached analysis for '{}'", company_name)
            return existing

    # Save uploaded files to a temp directory
    temp_dir = tempfile.mkdtemp()
    file_paths = []

    try:
        for file in files:
            temp_path = os.path.join(temp_dir, file.filename)
            with open(temp_path, "wb") as f:
                f.write(await file.read())
            file_paths.append(temp_path)

        # Create DB records
        company_id = upsert_company(company_name)
        run_id = create_run(company_id, status="running")

        # Run the extraction pipeline
        try:
            result_data = run_pipeline(file_paths)
            logger.info("[API] Pipeline returned {} top-level keys", len(result_data))
        except Exception as exc:
            error_msg = traceback.format_exc()
            logger.error("[API] Pipeline failed for '{}':\n{}", company_name, error_msg)
            update_run(run_id, status="failed", error=str(exc))
            raise HTTPException(status_code=500, detail=f"LLM Extraction failed: {exc}")

        if not result_data:
            update_run(run_id, status="failed", error="Pipeline returned empty result")
            raise HTTPException(status_code=500, detail="Pipeline returned empty result")

        # Extract currency and persist
        currency = result_data.get("currency", "USD")
        update_run(run_id, status="completed", result=result_data, currency=currency)

        # Build response (same shape the frontend already expects)
        response = {
            "company_name": company_name,
            "currency": currency,
            "financial_data": result_data.get("financial_data", []),
            "anomalies_and_risks": result_data.get("anomalies_and_risks", []),
            "company_overview": result_data.get("company_overview", {}),
            "quality_of_it": result_data.get("quality_of_it", {}),
            "macroeconomic_geo_view": result_data.get("macroeconomic_geo_view", []),
            "competitive_position": result_data.get("competitive_position", {}),
            "management_quality": result_data.get("management_quality", []),
        }
        logger.info("[API] Analysis complete for '{}' – currency='{}', fin_data_years={}",
                     company_name, currency, len(response["financial_data"]))
        return response

    finally:
        # Clean up temp files
        for path in file_paths:
            if os.path.exists(path):
                os.remove(path)
        if os.path.exists(temp_dir):
            os.rmdir(temp_dir)


@app.get("/api/analysis/{company_name}")
def get_company_analysis(company_name: str):
    """Return the latest completed analysis for a company."""
    data = get_latest_analysis(company_name)
    if not data:
        raise HTTPException(status_code=404, detail="Company not found")
    # Ensure computed ratios exist (handles old DB records missing them)
    if "financial_data" in data:
        enrich_financial_data(data["financial_data"])
    return data


@app.get("/api/analyses")
def list_all_analyses():
    """List all companies with their latest analysis timestamp."""
    return get_all_analyses()


@app.delete("/api/analysis/{company_name}")
def delete_company_analysis(company_name: str):
    """Delete a company and all its analysis runs."""
    deleted = delete_company(company_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Company not found")
    return {"message": f"Analysis for '{company_name}' deleted successfully"}


# ---------------------------------------------------------------------------
# Dev server
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=SERVER_HOST, port=SERVER_PORT, reload=True)
