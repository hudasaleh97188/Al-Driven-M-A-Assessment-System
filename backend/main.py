"""
main.py
-------
FastAPI entry point for the DealLens Analysis API.
"""

import json
import os
import tempfile
import traceback

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from loguru import logger

from app.logging_config import setup_logging
setup_logging()

from app.config import SERVER_HOST, SERVER_PORT
from app.database import (
    create_run, delete_company, get_all_analyses, get_latest_analysis,
    get_peer_rating, init_db, save_peer_rating, update_run, upsert_company,
    get_financial_statements, save_financial_edit, update_line_item,
    update_metric, recalculate_line_item_percentages, get_statement_by_id,
    save_overview_edit, get_overview_edits,
    get_currency_rate, upsert_currency_rate, get_all_currency_rates,
)
from app.ratios import enrich_financial_data, compute_ratios_from_metrics

# Only import these if they exist (they depend on external APIs)
try:
    from app.extractor import run_pipeline
    from app.peer_rating import run_peer_rating
    from app.converters.office_to_pdf import convert_to_pdf
except ImportError:
    run_pipeline = None
    run_peer_rating = None
    convert_to_pdf = None

# ---------------------------------------------------------------------------
app = FastAPI(title="DealLens Analysis API", version="3.0.0")

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
    logger.info("DealLens API started on {}:{}", SERVER_HOST, SERVER_PORT)

# ---------------------------------------------------------------------------
# Analysis Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/analyze")
async def analyze_company(
    company_name: str = Form(...),
    files: list[UploadFile] = File(...),
    force: bool = Form(False),
):
    logger.info("[API] POST /api/analyze – company='{}', files={}", company_name, len(files))

    if not force:
        existing = get_latest_analysis(company_name)
        if existing:
            if "financial_data" in existing:
                enrich_financial_data(existing["financial_data"])
            return existing

    if not run_pipeline or not convert_to_pdf:
        raise HTTPException(status_code=500, detail="Pipeline not available")

    temp_dir = tempfile.mkdtemp()
    file_paths = []

    try:
        for file in files:
            temp_path = os.path.join(temp_dir, file.filename)
            with open(temp_path, "wb") as f:
                f.write(await file.read())
            pdf_path = convert_to_pdf(temp_path, temp_dir)
            file_paths.append(pdf_path)

        company_id = upsert_company(company_name)
        run_id = create_run(company_id, status="running")

        try:
            result_data = run_pipeline(file_paths)
        except Exception as exc:
            update_run(run_id, status="failed", error=str(exc))
            raise HTTPException(status_code=500, detail=f"LLM Extraction failed: {exc}")

        if not result_data:
            update_run(run_id, status="failed", error="Pipeline returned empty result")
            raise HTTPException(status_code=500, detail="Pipeline returned empty result")

        currency = result_data.get("currency", "USD")
        update_run(run_id, status="completed", result=result_data, currency=currency)

        if run_peer_rating:
            try:
                if "financial_data" in result_data:
                    enrich_financial_data(result_data["financial_data"])
                result_data["company_name"] = company_name
                peer_rating_result = run_peer_rating(result_data, [])
                save_peer_rating(company_name, peer_rating_result)
            except Exception:
                logger.error("[API] Auto-scoring failed:\n{}", traceback.format_exc())

        return get_latest_analysis(company_name)
    finally:
        import shutil
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


@app.get("/api/analysis/{company_name}")
def get_company_analysis(company_name: str):
    data = get_latest_analysis(company_name)
    if not data:
        raise HTTPException(status_code=404, detail="Company not found")
    if "financial_data" in data:
        enrich_financial_data(data["financial_data"])
    # Compute ratios for each financial statement from metrics
    for stmt in data.get("financial_statements", []):
        computed = compute_ratios_from_metrics(stmt.get("metrics", {}))
        stmt["computed_ratios"] = computed
    return data


@app.get("/api/analyses")
def list_all_analyses():
    return get_all_analyses()


@app.delete("/api/analysis/{company_name}")
def delete_company_analysis(company_name: str):
    deleted = delete_company(company_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Company not found")
    return {"message": f"Analysis for '{company_name}' deleted successfully"}


# ---------------------------------------------------------------------------
# Financial Edit Endpoints
# ---------------------------------------------------------------------------

class EditItem(BaseModel):
    line_item_id: Optional[int] = None
    metric_name: Optional[str] = None
    old_value: float
    new_value: float
    comment: str

class BulkEditRequest(BaseModel):
    statement_id: int
    edits: List[EditItem]
    username: str = "admin"

@app.post("/api/financial/edit")
def bulk_edit_financials(request: BulkEditRequest):
    """Save multiple financial edits at once, then recalculate."""
    for edit in request.edits:
        save_financial_edit(
            statement_id=request.statement_id,
            line_item_id=edit.line_item_id,
            metric_name=edit.metric_name,
            old_value=edit.old_value,
            new_value=edit.new_value,
            comment=edit.comment,
            username=request.username
        )
    
    # Recalculate percentages
    recalculate_line_item_percentages(request.statement_id)
    
    # Recalculate derived metrics
    stmt = get_statement_by_id(request.statement_id)
    if stmt:
        computed = compute_ratios_from_metrics(stmt.get("metrics", {}))
        stmt["computed_ratios"] = computed
        return stmt
    
    return get_statement_by_id(request.statement_id)


@app.get("/api/financial/statement/{statement_id}")
def get_financial_statement(statement_id: int):
    stmt = get_statement_by_id(statement_id)
    if not stmt:
        raise HTTPException(status_code=404, detail="Statement not found")
    computed = compute_ratios_from_metrics(stmt.get("metrics", {}))
    stmt["computed_ratios"] = computed
    return stmt


# ---------------------------------------------------------------------------
# Overview Edit Endpoints
# ---------------------------------------------------------------------------

class OverviewEditItem(BaseModel):
    field_path: str
    old_value: str
    new_value: str
    comment: str

class OverviewEditRequest(BaseModel):
    run_id: int
    edits: List[OverviewEditItem]
    username: str = "admin"

@app.post("/api/overview/edit")
def edit_overview(request: OverviewEditRequest):
    for edit in request.edits:
        save_overview_edit(
            run_id=request.run_id,
            field_path=edit.field_path,
            old_value=edit.old_value,
            new_value=edit.new_value,
            comment=edit.comment,
            username=request.username
        )
    return {"status": "ok"}


@app.get("/api/overview/edits/{run_id}")
def get_overview_edits_endpoint(run_id: int):
    return get_overview_edits(run_id)


# ---------------------------------------------------------------------------
# Currency Rate Endpoints
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------


@app.get("/api/currency-rates")
def list_currency_rates():
    return get_all_currency_rates()


@app.get("/api/currency-rate/{currency}/{year}")
def get_rate(currency: str, year: int):
    rate = get_currency_rate(currency, year)
    if rate is None:
        raise HTTPException(status_code=404, detail="Rate not found")
    return {"currency": currency, "year": year, "rate_to_usd": rate}


# ---------------------------------------------------------------------------
# Comparison Endpoint
# ---------------------------------------------------------------------------

@app.get("/api/comparison")
def get_comparison_data():
    """Get comparison data for all analyzed companies."""
    analyses = get_all_analyses()
    result = []
    
    for item in analyses:
        if not item.get("analyzed_at"):
            continue
        data = get_latest_analysis(item["company_name"])
        if not data:
            continue
        
        # Get latest year financial statements
        stmts = data.get("financial_statements", [])
        if not stmts:
            continue
        
        latest_stmt = stmts[-1]  # Last = latest year
        metrics = latest_stmt.get("metrics", {})
        computed = compute_ratios_from_metrics(metrics)
        
        currency = latest_stmt.get("currency", data.get("currency", "USD"))
        year = latest_stmt.get("year", 0)
        
        # Get USD rate
        rate = get_currency_rate(currency, year)
        
        company_data = {
            "company_name": data["company_name"],
            "currency": currency,
            "year": year,
            "usd_rate": rate,
            "metrics": metrics,
            "computed_ratios": computed,
        }
        result.append(company_data)
    
    # Get all currency rates
    rates = get_all_currency_rates()
    
    return {"companies": result, "currency_rates": rates}


# ---------------------------------------------------------------------------
# Peer Rating Endpoints
# ---------------------------------------------------------------------------

class PeerRatingRequest(BaseModel):
    peers: list[str] = []

@app.post("/api/peer-rating/{company_name}")
async def run_peer_rating_endpoint(company_name: str, request: PeerRatingRequest):
    if not run_peer_rating:
        raise HTTPException(status_code=500, detail="Peer rating not available")
    
    analysis = get_latest_analysis(company_name)
    if not analysis:
        raise HTTPException(status_code=404, detail="No analysis found")

    if "financial_data" in analysis:
        enrich_financial_data(analysis["financial_data"])

    peer_analyses = []
    for peer_name in request.peers:
        p_analysis = get_latest_analysis(peer_name)
        if p_analysis:
            if "financial_data" in p_analysis:
                enrich_financial_data(p_analysis["financial_data"])
            peer_analyses.append(p_analysis)

    try:
        result = run_peer_rating(analysis, peer_analyses)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Peer rating failed: {exc}")

    save_peer_rating(company_name, result)
    return result


@app.get("/api/peer-rating/{company_name}")
def get_peer_rating_endpoint(company_name: str):
    data = get_peer_rating(company_name)
    if not data:
        raise HTTPException(status_code=404, detail="No peer rating found")
    return data


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=SERVER_HOST, port=SERVER_PORT, reload=True)
