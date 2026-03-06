"""
peer_rating.py
--------------
Orchestrator for the peer rating pipeline.

1. Extracts target company data from existing analysis
2. Extracts competitor data from peer analyses
3. Runs scoring engine (deterministic + single LLM call)
4. Returns structured peer rating result
"""

import json
import traceback
from typing import Optional

from google import genai
from google.genai import types
from loguru import logger

from app.peer_rating_scorer import compute_all_scores, ALL_CRITERIA


def _extract_target_data(analysis: dict) -> dict:
    """
    Extract peer-comparable data from the existing analysis of the target company.
    Financial figures are kept in their original currency — the peer extraction
    prompt asks competitors to report in USD.
    """
    overview = analysis.get("company_overview", {})
    fin_data = analysis.get("financial_data", [])
    quality_of_it = analysis.get("quality_of_it", {})
    competitive_pos = analysis.get("competitive_position", {})

    # Use the latest year's financial data
    latest = {}
    if fin_data:
        sorted_data = sorted(fin_data, key=lambda x: x.get("year", 0), reverse=True)
        latest = sorted_data[0].get("financial_health", {})

    scale = overview.get("operational_scale", {})
    shareholders = overview.get("shareholder_structure", [])

    # Use the LLM-extracted boolean from Stage 2 (falls back to False)
    is_public = analysis.get("is_publicly_listed", False)

    return {
        "company_id": analysis.get("company_id"),
        "company_name": analysis.get("company_name", "Unknown"),
        "pat": latest.get("pat"),
        "total_equity": latest.get("total_equity"),
        "gross_loan_portfolio": latest.get("gross_loan_portfolio"),
        "countries_of_operation": overview.get("countries_of_operation", []),
        "products_and_services": overview.get("description_of_products_and_services", ""),
        "is_publicly_listed": is_public,
        "number_of_shareholders": len(shareholders),
        "shareholders": [
            {"name": s.get("name", ""), "percentage": s.get("ownership_percentage")}
            for s in shareholders
        ],
        "management_team": [
            {
                "name": m.get("name", ""),
                "position": m.get("position", ""),
                "previous_roles": None,
            }
            for m in overview.get("management_team", [])
        ],
        "strategic_partners": overview.get("strategic_partners", []),
        "it_details": {
            "core_systems": ", ".join(quality_of_it.get("core_banking_systems", [])) if quality_of_it else "",
            "digital_adoption": quality_of_it.get("digital_channel_adoption", "") if quality_of_it else "",
            "recent_upgrades": ", ".join(quality_of_it.get("system_upgrades", [])) if quality_of_it else "",
        },
        "competitive_position": {
            "market_share_data": competitive_pos.get("market_share_data", ""),
            "industry_studies_summary": competitive_pos.get("industry_studies_summary", ""),
            "central_bank_sector_reports_summary": competitive_pos.get("central_bank_sector_reports_summary", ""),
        },
        "macroeconomic_geo_view": analysis.get("macroeconomic_geo_view", []),
        "currency": analysis.get("currency", "USDm"),
    }


def _enrich_target_management(target: dict, analysis: dict) -> dict:
    """Enrich target management with deep-dive data if available."""
    mgmt_quality = analysis.get("management_quality", [])
    if mgmt_quality:
        enriched_mgmt = []
        for m in target.get("management_team", []):
            # Find matching deep-dive entry
            match = next(
                (mq for mq in mgmt_quality if mq.get("name") == m.get("name")),
                None,
            )
            if match:
                m["previous_roles"] = match.get("previous_experience", "")
            enriched_mgmt.append(m)
        target["management_team"] = enriched_mgmt
    return target


# ---------------------------------------------------------------------------
# Summary generation
# ---------------------------------------------------------------------------

def _generate_summary(company_name: str, scores: list[dict], overall: float) -> str:
    """Generate a concise AI summary for the target company's peer rating."""
    strengths = sorted(scores, key=lambda s: s["score"], reverse=True)[:3]
    weaknesses = sorted(scores, key=lambda s: s["score"])[:2]

    strength_text = ", ".join(
        f"{s['criterion']} ({s['score']})" for s in strengths
    )
    weakness_text = ", ".join(
        f"{s['criterion']} ({s['score']})" for s in weaknesses
    )

    return (
        f"{strength_text} are key strengths. "
        f"{weakness_text} are primary discounts. "
        f"Recommend {'proceed with enhanced due diligence' if overall >= 2.5 else 'caution advised'}."
    )


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def run_peer_rating(analysis_data: dict, peer_analyses: list[dict]) -> dict:
    """
    Orchestrate the full peer rating pipeline.

    Args:
        analysis_data: The existing analysis dict for the target company.
        peer_analyses: List of analysis dicts for the selected peer companies.

    Returns:
        dict with keys: target_company, companies, scores, overall_scores, summaries.
    """
    company_name = analysis_data.get("company_name", "Unknown")
    logger.info("[PEER_RATING] Starting peer rating pipeline for '{}'", company_name)

    # 1. Extract target company data
    target = _extract_target_data(analysis_data)
    target = _enrich_target_management(target, analysis_data)
    logger.info("[PEER_RATING] Target data extracted: {}", target["company_name"])

    # 2. Extract peer data from passed-in analyses (may be empty)
    all_companies = [target]
    for p_analysis in peer_analyses:
        p_data = _extract_target_data(p_analysis)
        p_data = _enrich_target_management(p_data, p_analysis)
        all_companies.append(p_data)
        logger.info("[PEER_RATING] Processed peer data for '{}'", p_data["company_name"])

    logger.info("[PEER_RATING] Collected data for {} companies total", len(all_companies))

    # 3. Run scoring
    scoring_result = compute_all_scores(all_companies)

    # 4. Generate summaries
    summaries = {}
    for name, scores in scoring_result["scores"].items():
        overall = scoring_result["overall_scores"].get(name, 3.0)
        summaries[name] = _generate_summary(name, scores, overall)

    # 5. Build result
    # Clean up company data for frontend (remove large text fields)
    clean_companies = []
    for c in all_companies:
        clean = {
            "company_id": c.get("company_id"),
            "company_name": c["company_name"],
            "pat": c.get("pat"),
            "total_equity": c.get("total_equity"),
            "gross_loan_portfolio": c.get("gross_loan_portfolio"),
            "countries_of_operation": c.get("countries_of_operation", []),
            "products_and_services": c.get("products_and_services", ""),
            "is_publicly_listed": c.get("is_publicly_listed"),
            "number_of_shareholders": c.get("number_of_shareholders"),
            "strategic_partners": c.get("strategic_partners", []),
            "management_summary": _summarise_management(c.get("management_team", [])),
            "it_summary": _summarise_it(c.get("it_details", {})),
            "currency": "USDm",
        }

        # Compute ROE for display
        pat = c.get("pat")
        equity = c.get("total_equity")
        if pat is not None and equity and equity != 0:
            clean["roe"] = round(pat / equity * 100, 2)

        clean_companies.append(clean)

    result = {
        "target_company": company_name,
        "companies": clean_companies,
        "scores": scoring_result["scores"],
        "overall_scores": scoring_result["overall_scores"],
        "summaries": summaries,
    }

    logger.info("[PEER_RATING] Pipeline complete for '{}'. Overall scores: {}",
                company_name, scoring_result["overall_scores"])

    return result


def _summarise_management(team: list) -> str:
    if not team:
        return "No management data available."
    parts = []
    for m in team[:4]:
        name = m.get("name", "Unknown")
        pos = m.get("position", "")
        parts.append(f"{name} ({pos})")
    return "; ".join(parts)


def _summarise_it(it: dict) -> str:
    if not it:
        return "No IT data available."
    parts = []
    if it.get("core_systems"):
        parts.append(f"Core: {it['core_systems']}")
    if it.get("digital_adoption"):
        parts.append(f"Digital: {it['digital_adoption']}")
    if it.get("recent_upgrades"):
        parts.append(f"Upgrades: {it['recent_upgrades']}")
    return "; ".join(parts) if parts else "Limited IT data."
