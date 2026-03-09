"""
extractor.py
------------
Three-stage agentic extraction pipeline using Google Gemini on Vertex AI.

Stage 1 – extract_base_pdf()
    Reads PDF annual reports → structured financial & qualitative data.

Stage 2 – enrich_with_web_and_it()
    Google Search grounding to fill gaps from Stage 1 + IT quality assessment.

Stage 3 – deep_dive_macro_and_management()
    Google Search grounding for macro-economic data, competitive positioning,
    and management background research.

run_pipeline() orchestrates all three stages and merges outputs.

**Logging**: Every LLM call logs the full prompt and full response via loguru.
"""

import json
import os
import re
import traceback
from typing import List, Optional

from google import genai
from google.genai import types
from loguru import logger

from app.config import GCP_PROJECT_ID, VERTEX_LOCATION, PRIMARY_MODEL
from app.schemas import STAGE1_SCHEMA, STAGE2_SCHEMA, STAGE3_SCHEMA
from app.prompts import STAGE1_SYSTEM_PROMPT, build_stage2_prompt, build_stage3_prompt
from app.ratios import enrich_financial_data


# ---------------------------------------------------------------------------
# Client helper
# ---------------------------------------------------------------------------

def _get_client(project_id: Optional[str] = None) -> genai.Client:
    pid = project_id or GCP_PROJECT_ID
    return genai.Client(vertexai=True, project=pid, location=VERTEX_LOCATION)


def _parse_json_response(response_text: str, stage: str) -> dict:
    """Parse a JSON string from the LLM response, logging any failures."""
    try:
        data = json.loads(response_text)
        logger.info("[LLM_PARSE] Stage {} – JSON parsed successfully ({} top-level keys)", stage, len(data))
        return data
    except json.JSONDecodeError as exc:
        logger.error("[LLM_ERROR] Stage {} – Failed to parse JSON response: {}", stage, exc)
        logger.debug("[LLM_ERROR] Stage {} – Raw text that failed parsing:\n{}", stage, response_text)
        return {}


def _is_semantically_equal(v1, v2) -> bool:
    if type(v1) != type(v2):
        if isinstance(v1, (int, float)) and isinstance(v2, (int, float)):
             return v1 == v2
        return False
    if isinstance(v1, dict):
        if len(v1) != len(v2): return False
        for k in v1:
            if k not in v2: return False
            if not _is_semantically_equal(v1[k], v2[k]): return False
        return True
    if isinstance(v1, list):
        if len(v1) != len(v2): return False
        matched_v2 = set()
        for i, item1 in enumerate(v1):
            found_match = False
            for j, item2 in enumerate(v2):
                if j in matched_v2: continue
                if _is_semantically_equal(item1, item2):
                    matched_v2.add(j)
                    found_match = True
                    break
            if not found_match:
                return False
        return True
    if isinstance(v1, str):
        # Normalize strings: lowercase, strip common trailing punctuation/spaces
        s1 = re.sub(r'[\s\.\,]+$', '', v1.strip().lower())
        s2 = re.sub(r'[\s\.\,]+$', '', v2.strip().lower())
        return s1 == s2
    return v1 == v2


# ---------------------------------------------------------------------------
# Stage 1 – Base PDF extraction
# ---------------------------------------------------------------------------

def extract_base_pdf(
    file_paths: List[str],
    project_id: Optional[str] = None,
) -> dict:
    """
    Reads multiple PDF annual reports, sends them to Gemini, and returns a
    structured dict matching STAGE1_SCHEMA.
    """
    client = _get_client(project_id)

    contents: list = [STAGE1_SYSTEM_PROMPT]

    loaded_files = []
    for file_path in file_paths:
        if not os.path.exists(file_path):
            logger.warning("[STAGE1] File not found: {} – skipping.", file_path)
            continue
        with open(file_path, "rb") as f:
            pdf_bytes = f.read()
        contents.append(types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"))
        loaded_files.append(file_path)
        logger.info("[STAGE1] Loaded PDF: {} ({:.1f} MB)", file_path, len(pdf_bytes) / 1_048_576)

    if not loaded_files:
        logger.error("[STAGE1] No valid PDF files were loaded. Aborting.")
        return {}

    # ── Log the full request ────────────────────────────────────────────────
    logger.info(
        "[LLM_REQUEST] Stage 1 | model={} | files={} | schema_keys={} | thinking=HIGH | temp=0",
        PRIMARY_MODEL, loaded_files, list(STAGE1_SCHEMA.get("properties", {}).keys()),
    )
    logger.debug("[LLM_REQUEST] Stage 1 – Full system prompt:\n{}", STAGE1_SYSTEM_PROMPT)

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
    except Exception as exc:
        logger.error("[LLM_ERROR] Stage 1 – API call failed:\n{}", traceback.format_exc())
        raise

    # ── Log the full response ───────────────────────────────────────────────
    logger.info("[LLM_RESPONSE] Stage 1 – response length: {} chars", len(response.text) if response.text else 0)
    logger.debug("[LLM_RESPONSE] Stage 1 – Full output:\n{}", response.text)

    data = _parse_json_response(response.text, "1")

    return data


# ---------------------------------------------------------------------------
# Stage 2 – Web enrichment + IT quality
# ---------------------------------------------------------------------------

def enrich_with_web_and_it(
    base_data: dict,
    company_name: str,
    project_id: Optional[str] = None,
) -> dict:
    """
    Uses Google Search grounding to:
    - Fill missing fields from Stage 1
    - Assess IT stack, digital adoption, and cyber hygiene
    """
    client = _get_client(project_id)
    prompt = build_stage2_prompt(company_name, base_data)

    # ── Log the full request ────────────────────────────────────────────────
    logger.info(
        "[LLM_REQUEST] Stage 2 | model='gemini-3-flash-preview' | company='{}' | tools=[GoogleSearch] | temp=0 | thinking='MEDIUM'",
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
    except Exception as exc:
        logger.error("[LLM_ERROR] Stage 2 – API call failed:\n{}", traceback.format_exc())
        raise

    # ── Log the full response ───────────────────────────────────────────────
    logger.info("[LLM_RESPONSE] Stage 2 – response length: {} chars", len(response.text) if response.text else 0)
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
    Uses Google Search grounding to pull:
    - Macro-economic geo-view per country
    - Competitive positioning
    - Deep-dive management quality
    """
    client = _get_client(project_id)

    overview   = base_data.get("company_overview", {})
    countries  = overview.get("countries_of_operation", [])
    management = overview.get("management_team", [])
    products   = overview.get("description_of_products_and_services", "")
    prompt     = build_stage3_prompt(company_name, countries, management, products)

    # ── Log the full request ────────────────────────────────────────────────
    logger.info(
        "[LLM_REQUEST] Stage 3 | model='gemini-3-pro-preview' | company='{}' | countries={} | mgmt_count={} | tools=[GoogleSearch] | temp=0",
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

    # ── Log the full response ───────────────────────────────────────────────
    logger.info("[LLM_RESPONSE] Stage 3 – response length: {} chars", len(response.text) if response.text else 0)
    logger.debug("[LLM_RESPONSE] Stage 3 – Full output:\n{}", response.text)

    return _parse_json_response(response.text, "3")


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_pipeline(
    file_paths: List[str],
    project_id: Optional[str] = None,
) -> dict:
    """
    Orchestrates all three stages and returns a single merged dict ready for
    database persistence or JSON export.
    """
    logger.info("[PIPELINE] Starting 3-stage extraction pipeline with {} file(s)", len(file_paths))

    # ── Stage 1: Base PDF extraction ────────────────────────────────────────
    data = extract_base_pdf(file_paths, project_id)

    if not data:
        logger.error("[PIPELINE] Stage 1 returned empty result. Aborting pipeline.")
        return {}

    company_name = data.get("company_name", "")
    if not company_name or company_name == "Unknown Company":
        logger.warning(
            "[PIPELINE] Could not determine company name in Stage 1. "
            "Skipping web-search stages."
        )
        return data

    logger.info("[PIPELINE] Stage 1 complete – company='{}', currency='{}', years={}",
                company_name, data.get("currency"), len(data.get("financial_data", [])))

    data["data_sources"] = {
        "company_overview": {},
        "financial_data": {}
    }

    # ── Stage 2: Web enrichment + IT quality ────────────────────────────────
    try:
        stage2 = enrich_with_web_and_it(data, company_name, project_id)
        if stage2:
            # Deep Merge company_overview:
            s2_overview = stage2.get("company_overview", {})
            if "company_overview" not in data:
                data["company_overview"] = {}
            for k, v in s2_overview.items():
                if v:  # Only overwrite if Stage 2 found something non-empty
                    # If it's a list or dict that is not empty, or a truthy primitive
                    s1_val = data["company_overview"].get(k)
                    if not _is_semantically_equal(s1_val, v):
                        data["company_overview"][k] = v
                        data["data_sources"]["company_overview"][k] = "Web Search"

            # Merge financial_data by year:
            s2_fin = stage2.get("financial_data", [])
            s1_fin = data.get("financial_data", [])
            
            s1_fin_dict = {item.get("year"): item for item in s1_fin if item.get("year")}
            
            for s2_item in s2_fin:
                year = s2_item.get("year")
                if not year: continue
                
                if str(year) not in data["data_sources"]["financial_data"]:
                    data["data_sources"]["financial_data"][str(year)] = {}
                
                if year in s1_fin_dict:
                    s1_health = s1_fin_dict[year].get("financial_health", {})
                    s2_health = s2_item.get("financial_health", {})
                    
                    for k, v in s2_health.items():
                        if v is not None:  # Overwrite missing numericals/strings
                            s1_val = s1_health.get(k)
                            if _is_semantically_equal(s1_val, v):
                                continue
                            if v == -1 and s1_val != -1:
                                continue # Don't overwrite a valid number with missing (-1)
                            s1_health[k] = v
                            data["data_sources"]["financial_data"][str(year)][k] = "Web Search"
                else:
                    # If this is a new year added by Stage 2
                    s1_fin_dict[year] = s2_item
                    for k in s2_item.get("financial_health", {}).keys():
                         data["data_sources"]["financial_data"][str(year)][k] = "Web Search"
                    
            data["financial_data"] = list(s1_fin_dict.values())

            if stage2.get("quality_of_it"):
                data["quality_of_it"] = stage2["quality_of_it"]
            if "is_publicly_listed" in stage2:
                data["is_publicly_listed"] = stage2["is_publicly_listed"]
            logger.info("[PIPELINE] Stage 2 complete – merged successfully")
        else:
            logger.warning("[PIPELINE] Stage 2 returned empty result – using Stage 1 data only")
    except Exception:
        logger.error("[PIPELINE] Stage 2 failed – continuing with Stage 1 data:\n{}", traceback.format_exc())

    # ── Stage 3: Macro + management deep dive ───────────────────────────────
    try:
        stage3 = deep_dive_macro_and_management(data, company_name, project_id)
        if stage3:
            # Only update if list is non-empty
            s3_macro = stage3.get("macroeconomic_geo_view", [])
            if s3_macro:
                data["macroeconomic_geo_view"] = s3_macro
                
            s3_mgmt = stage3.get("management_quality", [])
            if s3_mgmt:
                data["management_quality"] = s3_mgmt
                
            # Deep merge competitive position
            s3_comp = stage3.get("competitive_position", {})
            if "competitive_position" not in data:
                data["competitive_position"] = {}
                
            for k, v in s3_comp.items():
                if v: # Only overwrite if value exists and is truthy
                    data["competitive_position"][k] = v
                    
            logger.info("[PIPELINE] Stage 3 complete – merged successfully")
        else:
            logger.warning("[PIPELINE] Stage 3 returned empty result")
    except Exception:
        logger.error("[PIPELINE] Stage 3 failed – continuing with existing data:\n{}", traceback.format_exc())

    # ── Final Compute & Ratios ──────────────────────────────────────────────
    if "financial_data" in data and data["financial_data"]:
        data["financial_data"] = enrich_financial_data(data["financial_data"])
        logger.info("[PIPELINE] Re-computed ratios after merges")

    logger.info("[PIPELINE] Pipeline complete for '{}' – {} top-level keys in result",
                company_name, len(data))
    return data
