"""
main.py
-------
FastAPI entry point for the DealLens Analysis API.

Key design decisions
--------------------
  * The backend stores only **raw extracted metrics** — no computed ratios.
    Ratios are computed client-side (``computeRatios.ts``).
  * File ingestion supports PDF, PPTX, CSV, and Excel natively
    (no win32com / PDF conversion).
  * Currency conversion to USD is performed in the backend **before**
    peer scoring — the LLM prompt never sees financial numbers.
  * Every HTTP request is tagged with a short ``request_id`` for log
    traceability.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import traceback
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from pydantic import BaseModel

# ── Logging (must be configured before other app imports) ──────────────────
from app.logging_config import setup_logging, bind_request_id, get_request_id

setup_logging()

# ── Application imports ────────────────────────────────────────────────────
from app.config import SERVER_HOST, SERVER_PORT, SUPPORTED_UPLOAD_EXTENSIONS
from app.database import (
    create_run,
    delete_company,
    get_all_analyses,
    get_all_currency_rates,
    get_currency_rate,
    get_financial_statements,
    get_latest_analysis,
    get_overview_edits,
    get_peer_rating,
    get_statement_by_id,
    init_db,
    recalculate_line_item_percentages,
    save_financial_edit,
    save_overview_edit,
    save_peer_rating,
    update_line_item,
    update_metric,
    update_run,
    upsert_company,
    upsert_currency_rate,
)

# Pipeline imports (graceful fallback if Vertex AI SDK not available)
try:
    from app.extractor import run_pipeline
    from app.peer_rating import run_peer_rating
except ImportError:
    run_pipeline = None  # type: ignore[assignment]
    run_peer_rating = None  # type: ignore[assignment]


# ═══════════════════════════════════════════════════════════════════════════
# App initialisation
# ═══════════════════════════════════════════════════════════════════════════

app = FastAPI(title="DealLens Analysis API", version="4.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request-ID middleware ──────────────────────────────────────────────────

@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Inject a unique request_id into every log line for the request."""
    rid = bind_request_id(request.headers.get("X-Request-ID"))
    logger.info(
        "[HTTP] {} {} (rid={})",
        request.method, request.url.path, rid,
    )
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    return response


@app.on_event("startup")
def startup_event():
    init_db()
    logger.info("DealLens API v4.0 started on {}:{}", SERVER_HOST, SERVER_PORT)


# ═══════════════════════════════════════════════════════════════════════════
# Analysis endpoints
# ═══════════════════════════════════════════════════════════════════════════

@app.post("/api/analyze")
async def analyze_company(
    company_name: str = Form(...),
    files: list[UploadFile] = File(...),
    force: bool = Form(False),
):
    """
    Upload documents and run the 3-stage extraction pipeline.

    Supported file types: PDF, PPTX, CSV, XLSX/XLS.
    """
    logger.info(
        "[API] POST /api/analyze – company='{}', files={}, force={}",
        company_name, len(files), force,
    )

    # Return cached result unless forced re-analysis
    if not force:
        existing = get_latest_analysis(company_name)
        if existing:
            logger.info("[API] Returning cached analysis for '{}'", company_name)
            return existing

    if run_pipeline is None:
        raise HTTPException(status_code=500, detail="Pipeline not available (missing SDK)")

    # ── Save uploaded files to a temp directory ────────────────────────────
    temp_dir = tempfile.mkdtemp()
    file_paths: list[str] = []

    try:
        for upload in files:
            ext = os.path.splitext(upload.filename or "")[1].lower()
            if ext not in SUPPORTED_UPLOAD_EXTENSIONS:
                logger.warning(
                    "[API] Skipping unsupported file '{}' (ext='{}')",
                    upload.filename, ext,
                )
                continue

            temp_path = os.path.join(temp_dir, upload.filename)
            content = await upload.read()
            with open(temp_path, "wb") as fh:
                fh.write(content)
            file_paths.append(temp_path)
            logger.info("[API] Saved upload: {} ({:.1f} KB)", upload.filename, len(content) / 1024)

        if not file_paths:
            raise HTTPException(
                status_code=400,
                detail=f"No supported files. Accepted: {', '.join(sorted(SUPPORTED_UPLOAD_EXTENSIONS))}",
            )

        # ── Run pipeline ──────────────────────────────────────────────────
        company_id = upsert_company(company_name)
        run_id = create_run(company_id, status="running")

        try:
            result_data = run_pipeline(file_paths)
        except Exception as exc:
            update_run(run_id, status="failed", error=str(exc))
            logger.error("[API] Pipeline failed for '{}': {}", company_name, exc)
            raise HTTPException(status_code=500, detail=f"LLM extraction failed: {exc}")

        if not result_data:
            update_run(run_id, status="failed", error="Pipeline returned empty result")
            raise HTTPException(status_code=500, detail="Pipeline returned empty result")

        currency = result_data.get("currency", "USD")
        update_run(run_id, status="completed", result=result_data, currency=currency)
        logger.info(
            "[API] Pipeline complete for '{}' (run_id={}, currency={})",
            company_name, run_id, currency,
        )

        # ── Auto-score (peer rating with no peers = self-score) ───────────
        if run_peer_rating:
            try:
                result_data["company_name"] = company_name
                peer_result = run_peer_rating(result_data, [])
                save_peer_rating(company_name, peer_result)
                logger.info("[API] Auto-scoring complete for '{}'", company_name)
            except Exception:
                logger.error("[API] Auto-scoring failed:\n{}", traceback.format_exc())

        return get_latest_analysis(company_name)

    finally:
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)


@app.get("/api/analysis/{company_name}")
def get_company_analysis(company_name: str):
    """Return the latest completed analysis for a company."""
    data = get_latest_analysis(company_name)
    if not data:
        raise HTTPException(status_code=404, detail="Company not found")
    return data


@app.get("/api/analyses")
def list_all_analyses():
    """List all companies with their latest analysis timestamp."""
    return get_all_analyses()


@app.delete("/api/analysis/{company_name}")
def delete_company_analysis(company_name: str):
    """Delete a company and all associated data."""
    deleted = delete_company(company_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Company not found")
    logger.info("[API] Deleted company '{}'", company_name)
    return {"message": f"Analysis for '{company_name}' deleted successfully"}


# ═══════════════════════════════════════════════════════════════════════════
# Financial edit endpoints
# ═══════════════════════════════════════════════════════════════════════════

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
    """Save multiple financial edits at once, then recalculate percentages."""
    logger.info(
        "[API] POST /api/financial/edit – stmt_id={}, edits={}, user='{}'",
        request.statement_id, len(request.edits), request.username,
    )

    for edit in request.edits:
        save_financial_edit(
            statement_id=request.statement_id,
            line_item_id=edit.line_item_id,
            metric_name=edit.metric_name,
            old_value=edit.old_value,
            new_value=edit.new_value,
            comment=edit.comment,
            username=request.username,
        )

    recalculate_line_item_percentages(request.statement_id)

    stmt = get_statement_by_id(request.statement_id)
    return stmt or {"status": "ok"}


@app.get("/api/financial/statement/{statement_id}")
def get_financial_statement(statement_id: int):
    """Get a single financial statement with raw metrics."""
    stmt = get_statement_by_id(statement_id)
    if not stmt:
        raise HTTPException(status_code=404, detail="Statement not found")
    return stmt


# ═══════════════════════════════════════════════════════════════════════════
# Overview edit endpoints
# ═══════════════════════════════════════════════════════════════════════════

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
    """Save overview field edits."""
    logger.info(
        "[API] POST /api/overview/edit – run_id={}, edits={}, user='{}'",
        request.run_id, len(request.edits), request.username,
    )
    for edit in request.edits:
        save_overview_edit(
            run_id=request.run_id,
            field_path=edit.field_path,
            old_value=edit.old_value,
            new_value=edit.new_value,
            comment=edit.comment,
            username=request.username,
        )
    return {"status": "ok"}


@app.get("/api/overview/edits/{run_id}")
def get_overview_edits_endpoint(run_id: int):
    """Get all overview edits for a run."""
    return get_overview_edits(run_id)


# ═══════════════════════════════════════════════════════════════════════════
# Currency rate endpoints
# ═══════════════════════════════════════════════════════════════════════════

class CurrencyRateRequest(BaseModel):
    currency: str
    year: int
    rate_to_usd: float
    username: str = "admin"


@app.get("/api/currency-rates")
def list_currency_rates():
    """List all stored currency rates."""
    return get_all_currency_rates()


@app.get("/api/currency-rate/{currency}/{year}")
def get_rate(currency: str, year: int):
    """Get the USD conversion rate for a specific currency and year."""
    rate = get_currency_rate(currency, year)
    if rate is None:
        raise HTTPException(status_code=404, detail="Rate not found")
    return {"currency": currency, "year": year, "rate_to_usd": rate}


@app.post("/api/currency-rate")
def set_rate(request: CurrencyRateRequest):
    """Create or update a currency rate."""
    logger.info(
        "[API] POST /api/currency-rate – {}:{} → {} (user='{}')",
        request.currency, request.year, request.rate_to_usd, request.username,
    )
    upsert_currency_rate(
        currency=request.currency,
        year=request.year,
        rate=request.rate_to_usd,
        username=request.username,
    )
    return {"status": "ok"}


# ═══════════════════════════════════════════════════════════════════════════
# Comparison endpoint
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/comparison")
def get_comparison_data():
    """
    Get comparison data for all analysed companies.

    Returns raw metrics per company (latest year) plus currency rates.
    Ratios are computed on the frontend.
    """
    analyses = get_all_analyses()
    result: list[dict] = []

    for item in analyses:
        if not item.get("analyzed_at"):
            continue

        data = get_latest_analysis(item["company_name"])
        if not data:
            continue

        stmts = data.get("financial_statements", [])
        if not stmts:
            continue

        latest_stmt = stmts[-1]  # last = latest year
        metrics = latest_stmt.get("metrics", {})
        currency = latest_stmt.get("currency", data.get("currency", "USD"))
        year = latest_stmt.get("year", 0)
        rate = get_currency_rate(currency, year)

        result.append({
            "company_name": data["company_name"],
            "currency": currency,
            "year": year,
            "usd_rate": rate,
            "metrics": metrics,
        })

    rates = get_all_currency_rates()
    return {"companies": result, "currency_rates": rates}


# ═══════════════════════════════════════════════════════════════════════════
# Peer rating endpoints
# ═══════════════════════════════════════════════════════════════════════════

class PeerRatingRequest(BaseModel):
    peers: list[str] = []


@app.post("/api/peer-rating/{company_name}")
async def run_peer_rating_endpoint(company_name: str, request: PeerRatingRequest):
    """Run peer rating for a company against selected peers."""
    if run_peer_rating is None:
        raise HTTPException(status_code=500, detail="Peer rating not available")

    analysis = get_latest_analysis(company_name)
    if not analysis:
        raise HTTPException(status_code=404, detail="No analysis found")

    logger.info(
        "[API] POST /api/peer-rating/{} – peers={}",
        company_name, request.peers,
    )

    peer_analyses: list[dict] = []
    for peer_name in request.peers:
        p_analysis = get_latest_analysis(peer_name)
        if p_analysis:
            peer_analyses.append(p_analysis)
        else:
            logger.warning("[API] Peer '{}' not found, skipping", peer_name)

    try:
        result = run_peer_rating(analysis, peer_analyses)
    except Exception as exc:
        logger.error("[API] Peer rating failed:\n{}", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Peer rating failed: {exc}")

    save_peer_rating(company_name, result)
    return result


@app.get("/api/peer-rating/{company_name}")
def get_peer_rating_endpoint(company_name: str):
    """Get the latest peer rating for a company."""
    data = get_peer_rating(company_name)
    if not data:
        raise HTTPException(status_code=404, detail="No peer rating found")
    return data


# ═══════════════════════════════════════════════════════════════════════════
# Health check
# ═══════════════════════════════════════════════════════════════════════════

@app.get("/api/health")
def health_check():
    """Simple health check endpoint."""
    return {"status": "ok", "version": "4.0.0"}


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=SERVER_HOST, port=SERVER_PORT, reload=True)
