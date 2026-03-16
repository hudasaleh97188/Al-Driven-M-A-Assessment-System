"""
extractor.py
------------
Three-stage agentic extraction pipeline using Google Gemini on Vertex AI.

Stage 1 – extract_from_documents()
    Reads uploaded files (PDF, PPTX, CSV, Excel) → structured financial
    & qualitative data.  Each format is ingested natively:
      * PDF   → application/pdf
      * PPTX  → application/vnd.openxmlformats-officedocument.presentationml.presentation
      * CSV   → text/csv
      * Excel → pre-processed to text/plain via openpyxl

Stage 2 – enrich_with_web_and_it()
    Google Search grounding to fill gaps from Stage 1 + IT quality assessment.

Stage 3 – deep_dive_macro_and_management()
    Google Search grounding for macro-economic data, competitive positioning,
    and management background research.

run_pipeline() orchestrates all three stages and merges outputs.
"""

from __future__ import annotations

import json
import re
import traceback
from typing import List, Optional

from google import genai
from google.genai import types
from loguru import logger

from app.config import GCP_PROJECT_ID, VERTEX_LOCATION, PRIMARY_MODEL
from app.converters.file_ingest import ContentPart, ingest_files
from app.schemas import STAGE1_SCHEMA, STAGE2_SCHEMA, STAGE3_SCHEMA
from app.prompts import STAGE1_SYSTEM_PROMPT, build_stage2_prompt, build_stage3_prompt


# ---------------------------------------------------------------------------
# Gemini client helper
# ---------------------------------------------------------------------------

def _get_client(project_id: Optional[str] = None) -> genai.Client:
    """Return a Vertex AI Gemini client."""
    pid = project_id or GCP_PROJECT_ID
    return genai.Client(vertexai=True, project=pid, location=VERTEX_LOCATION)


# ---------------------------------------------------------------------------
# JSON parsing helper
# ---------------------------------------------------------------------------

def _parse_json_response(response_text: str, stage: str) -> dict:
    """Parse a JSON string from the LLM response, logging any failures."""
    try:
        data = json.loads(response_text)
        logger.info(
            "[LLM_PARSE] Stage {} – JSON parsed OK ({} top-level keys)",
            stage, len(data),
        )
        return data
    except json.JSONDecodeError as exc:
        logger.error("[LLM_ERROR] Stage {} – JSON parse failed: {}", stage, exc)
        logger.debug("[LLM_ERROR] Stage {} – Raw text:\n{}", stage, response_text)
        return {}


# ---------------------------------------------------------------------------
# Semantic equality (for merge deduplication)
# ---------------------------------------------------------------------------

def _is_semantically_equal(v1, v2) -> bool:
    """Check whether two values are semantically identical (for merge logic)."""
    if type(v1) != type(v2):
        if isinstance(v1, (int, float)) and isinstance(v2, (int, float)):
            return v1 == v2
        return False
    if isinstance(v1, dict):
        if len(v1) != len(v2):
            return False
        return all(
            k in v2 and _is_semantically_equal(v1[k], v2[k]) for k in v1
        )
    if isinstance(v1, list):
        if len(v1) != len(v2):
            return False
        matched = set()
        for item1 in v1:
            found = False
            for j, item2 in enumerate(v2):
                if j not in matched and _is_semantically_equal(item1, item2):
                    matched.add(j)
                    found = True
                    break
            if not found:
                return False
        return True
    if isinstance(v1, str):
        s1 = re.sub(r"[\s.,]+$", "", v1.strip().lower())
        s2 = re.sub(r"[\s.,]+$", "", v2.strip().lower())
        return s1 == s2
    return v1 == v2


# ---------------------------------------------------------------------------
# Stage 1 – Document extraction (PDF / PPTX / CSV / Excel)
# ---------------------------------------------------------------------------

def extract_from_documents(
    file_paths: List[str],
    project_id: Optional[str] = None,
) -> dict:
    """
    Ingest uploaded files and send them to Gemini for structured extraction.

    Supported formats:
      * PDF  → passed as application/pdf
      * PPTX → passed as application/vnd.openxmlformats-officedocument.presentationml.presentation
      * CSV  → passed as text/csv
      * XLSX → pre-processed to structured text, passed as text/plain
    """
    client = _get_client(project_id)

    # Build Gemini content parts from uploaded files
    content_parts: list[ContentPart] = ingest_files(file_paths)
    if not content_parts:
        logger.error("[STAGE1] No valid files were ingested. Aborting.")
        return {}

    # Assemble the Gemini request: system prompt + file parts
    contents: list = [STAGE1_SYSTEM_PROMPT]
    for part in content_parts:
        contents.append(
            types.Part.from_bytes(data=part.data, mime_type=part.mime_type)
        )
        logger.info(
            "[STAGE1] Attached file: {} ({})",
            part.source_filename, part.mime_type,
        )

    logger.info(
        "[LLM_REQUEST] Stage 1 | model={} | files={} | thinking=HIGH | temp=0",
        PRIMARY_MODEL,
        [p.source_filename for p in content_parts],
    )

    try:
        response = client.models.generate_content(
            model=PRIMARY_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=STAGE1_SCHEMA,
                thinking_config=types.ThinkingConfig(
                    thinking_level=types.ThinkingLevel.HIGH
                ),
                temperature=0,
            ),
        )
    except Exception:
        logger.error("[LLM_ERROR] Stage 1 – API call failed:\n{}", traceback.format_exc())
        raise

    logger.info(
        "[LLM_RESPONSE] Stage 1 – {} chars",
        len(response.text) if response.text else 0,
    )
    logger.debug("[LLM_RESPONSE] Stage 1 – Full output:\n{}", response.text)

    return _parse_json_response(response.text, "1")


# ---------------------------------------------------------------------------
# Stage 2 – Web enrichment + IT quality
# ---------------------------------------------------------------------------

def enrich_with_web_and_it(
    base_data: dict,
    company_name: str,
    project_id: Optional[str] = None,
) -> dict:
    """
    Uses Google Search grounding to fill missing fields from Stage 1 and
    assess the company's IT stack, digital adoption, and cyber hygiene.
    """
    client = _get_client(project_id)
    prompt = build_stage2_prompt(company_name, base_data)

    logger.info(
        "[LLM_REQUEST] Stage 2 | model=gemini-3-flash-preview | company='{}' | tools=[GoogleSearch]",
        company_name,
    )
    logger.debug("[LLM_REQUEST] Stage 2 – Full prompt:\n{}", prompt)

    try:
        response = client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=STAGE2_SCHEMA,
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=0,
                thinking_config=types.ThinkingConfig(thinking_level="MEDIUM"),
            ),
        )
    except Exception:
        logger.error("[LLM_ERROR] Stage 2 – API call failed:\n{}", traceback.format_exc())
        raise

    logger.info(
        "[LLM_RESPONSE] Stage 2 – {} chars",
        len(response.text) if response.text else 0,
    )
    logger.debug("[LLM_RESPONSE] Stage 2 – Full output:\n{}", response.text)

    return _parse_json_response(response.text, "2")


# ---------------------------------------------------------------------------
# Stage 3 – Macro + management deep dive
# ---------------------------------------------------------------------------

def deep_dive_macro_and_management(
    base_data: dict,
    company_name: str,
    project_id: Optional[str] = None,
) -> dict:
    """
    Uses Google Search grounding to pull macro-economic geo-view per country,
    competitive positioning, and deep-dive management quality.
    """
    client = _get_client(project_id)

    overview = base_data.get("company_overview", {})
    countries = overview.get("countries_of_operation", [])
    management = overview.get("management_team", [])
    products = overview.get("description_of_products_and_services", "")
    prompt = build_stage3_prompt(company_name, countries, management, products)

    logger.info(
        "[LLM_REQUEST] Stage 3 | model=gemini-3-pro-preview | company='{}' | countries={} | mgmt_count={}",
        company_name, countries, len(management),
    )
    logger.debug("[LLM_REQUEST] Stage 3 – Full prompt:\n{}", prompt)

    try:
        response = client.models.generate_content(
            model="gemini-3-pro-preview",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=STAGE3_SCHEMA,
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=0,
            ),
        )
    except Exception:
        logger.error("[LLM_ERROR] Stage 3 – API call failed:\n{}", traceback.format_exc())
        raise

    logger.info(
        "[LLM_RESPONSE] Stage 3 – {} chars",
        len(response.text) if response.text else 0,
    )
    logger.debug("[LLM_RESPONSE] Stage 3 – Full output:\n{}", response.text)

    return _parse_json_response(response.text, "3")


# ---------------------------------------------------------------------------
# Merge helpers
# ---------------------------------------------------------------------------

def _merge_overview(data: dict, stage2: dict, data_sources: dict) -> None:
    """Merge Stage 2 company_overview into the master data dict."""
    s2_overview = stage2.get("company_overview", {})
    if "company_overview" not in data:
        data["company_overview"] = {}

    for key, val in s2_overview.items():
        if not val:
            continue
        existing = data["company_overview"].get(key)
        if not _is_semantically_equal(existing, val):
            data["company_overview"][key] = val
            data_sources.setdefault("company_overview", {})[key] = "Web Search"


def _merge_financial_data(data: dict, stage2: dict, data_sources: dict) -> None:
    """Merge Stage 2 financial_data into the master data dict by year."""
    s2_fin = stage2.get("financial_data", [])
    s1_fin = data.get("financial_data", [])
    s1_by_year = {item.get("year"): item for item in s1_fin if item.get("year")}

    for s2_item in s2_fin:
        year = s2_item.get("year")
        if not year:
            continue

        year_key = str(year)
        data_sources.setdefault("financial_data", {}).setdefault(year_key, {})

        if year in s1_by_year:
            s1_health = s1_by_year[year].get("financial_health", {})
            s2_health = s2_item.get("financial_health", {})
            for k, v in s2_health.items():
                if v is None:
                    continue
                existing = s1_health.get(k)
                if _is_semantically_equal(existing, v):
                    continue
                if v == -1 and existing != -1:
                    continue
                s1_health[k] = v
                data_sources["financial_data"][year_key][k] = "Web Search"
        else:
            s1_by_year[year] = s2_item
            for k in s2_item.get("financial_health", {}).keys():
                data_sources["financial_data"][year_key][k] = "Web Search"

    data["financial_data"] = list(s1_by_year.values())


def _merge_stage3(data: dict, stage3: dict) -> None:
    """Merge Stage 3 results (macro, competitive, management) into master data."""
    s3_macro = stage3.get("macroeconomic_geo_view", [])
    if s3_macro:
        data["macroeconomic_geo_view"] = s3_macro

    s3_mgmt = stage3.get("management_quality", [])
    if s3_mgmt:
        data["management_quality"] = s3_mgmt

    s3_comp = stage3.get("competitive_position", {})
    if "competitive_position" not in data:
        data["competitive_position"] = {}
    for k, v in s3_comp.items():
        if v:
            data["competitive_position"][k] = v


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_pipeline(
    file_paths: List[str],
    project_id: Optional[str] = None,
) -> dict:
    """
    Orchestrate all three extraction stages and return a single merged dict
    ready for database persistence or JSON export.
    """
    logger.info(
        "[PIPELINE] Starting 3-stage extraction with {} file(s)", len(file_paths)
    )

    # ── Stage 1: Document extraction ───────────────────────────────────────
    data = extract_from_documents(file_paths, project_id)
    if not data:
        logger.error("[PIPELINE] Stage 1 returned empty result. Aborting.")
        return {}

    company_name = data.get("company_name", "")
    if not company_name or company_name == "Unknown Company":
        logger.warning(
            "[PIPELINE] Could not determine company name. Skipping web stages."
        )
        return data

    logger.info(
        "[PIPELINE] Stage 1 complete – company='{}', currency='{}', years={}",
        company_name, data.get("currency"), len(data.get("financial_data", [])),
    )

    data_sources: dict = {"company_overview": {}, "financial_data": {}}
    data["data_sources"] = data_sources

    # ── Stage 2: Web enrichment + IT quality ───────────────────────────────
    try:
        stage2 = enrich_with_web_and_it(data, company_name, project_id)
        if stage2:
            _merge_overview(data, stage2, data_sources)
            _merge_financial_data(data, stage2, data_sources)

            if stage2.get("quality_of_it"):
                data["quality_of_it"] = stage2["quality_of_it"]
            if "is_publicly_listed" in stage2:
                data["is_publicly_listed"] = stage2["is_publicly_listed"]

            logger.info("[PIPELINE] Stage 2 complete – merged successfully")
        else:
            logger.warning("[PIPELINE] Stage 2 returned empty – using Stage 1 only")
    except Exception:
        logger.error(
            "[PIPELINE] Stage 2 failed – continuing with Stage 1:\n{}",
            traceback.format_exc(),
        )

    # ── Stage 3: Macro + management deep dive ──────────────────────────────
    try:
        stage3 = deep_dive_macro_and_management(data, company_name, project_id)
        if stage3:
            _merge_stage3(data, stage3)
            logger.info("[PIPELINE] Stage 3 complete – merged successfully")
        else:
            logger.warning("[PIPELINE] Stage 3 returned empty")
    except Exception:
        logger.error(
            "[PIPELINE] Stage 3 failed – continuing with existing data:\n{}",
            traceback.format_exc(),
        )

    logger.info(
        "[PIPELINE] Pipeline complete for '{}' – {} top-level keys",
        company_name, len(data),
    )
    return data
