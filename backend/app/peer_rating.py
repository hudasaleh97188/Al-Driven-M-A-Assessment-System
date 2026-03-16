"""
peer_rating.py
--------------
Orchestrator for the peer rating pipeline.

Flow:
  1. Extract target + peer company data from existing analyses.
  2. Convert financial metrics (PAT, equity, GLP) to USD millions
     using ``currency_rates.rate_to_usd`` from the database.
  3. Run the scoring engine (deterministic + single LLM call).
  4. Return structured peer rating result.

Currency conversion is done HERE, not inside the LLM prompt.
"""

from __future__ import annotations

import traceback
from typing import Optional

from loguru import logger

from app.database import get_currency_rate
from app.peer_rating_scorer import compute_all_scores, ALL_CRITERIA


# ---------------------------------------------------------------------------
# Data extraction helpers
# ---------------------------------------------------------------------------

def _extract_company_data(analysis: dict) -> dict:
    """
    Extract peer-comparable data from an existing analysis dict.

    Financial figures are kept in their ORIGINAL currency at this stage.
    ``_convert_to_usd()`` is applied later.
    """
    overview = analysis.get("company_overview", {})
    fin_data = analysis.get("financial_data", [])
    quality_of_it = analysis.get("quality_of_it", {})
    competitive_pos = analysis.get("competitive_position", {})

    # Latest year's financial health
    latest: dict = {}
    latest_year: int = 0
    if fin_data:
        sorted_data = sorted(fin_data, key=lambda x: x.get("year", 0), reverse=True)
        latest = sorted_data[0].get("financial_health", {})
        latest_year = sorted_data[0].get("year", 0)

    scale = overview.get("operational_scale", {})
    shareholders = overview.get("shareholder_structure", [])
    is_public = analysis.get("is_publicly_listed", False)

    return {
        "company_id": analysis.get("company_id"),
        "company_name": analysis.get("company_name", "Unknown"),
        # Raw financial metrics (original currency)
        "pat": latest.get("pat"),
        "total_equity": latest.get("total_equity"),
        "gross_loan_portfolio": latest.get("gross_loan_portfolio"),
        # Metadata for currency conversion
        "currency": analysis.get("currency", "USD"),
        "latest_year": latest_year,
        # Qualitative fields
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
            "central_bank_sector_reports_summary": competitive_pos.get(
                "central_bank_sector_reports_summary", ""
            ),
        },
        "macroeconomic_geo_view": analysis.get("macroeconomic_geo_view", []),
    }


def _enrich_management(target: dict, analysis: dict) -> None:
    """Enrich management with deep-dive data if available (mutates in-place)."""
    mgmt_quality = analysis.get("management_quality", [])
    if not mgmt_quality:
        return
    for m in target.get("management_team", []):
        match = next(
            (mq for mq in mgmt_quality if mq.get("name") == m.get("name")),
            None,
        )
        if match:
            m["previous_roles"] = match.get("previous_experience", "")


# ---------------------------------------------------------------------------
# Currency conversion
# ---------------------------------------------------------------------------

_FINANCIAL_KEYS = ("pat", "total_equity", "gross_loan_portfolio")


def _convert_to_usd(company: dict) -> None:
    """
    Convert PAT, equity, and GLP from original currency to **USD millions**
    using the rate stored in ``currency_rates``.

    Mutates the dict in-place.  If no rate is found the values are left
    unchanged and a warning is logged.
    """
    currency = company.get("currency", "USD")
    year = company.get("latest_year", 0)
    name = company["company_name"]

    # If already USD, just convert to millions
    if currency.upper() in ("USD", "USDM"):
        for key in _FINANCIAL_KEYS:
            val = company.get(key)
            if val is not None:
                company[key] = val / 1_000_000
        logger.info(
            "[PEER_RATING] '{}': currency=USD – divided by 1M for USDm",
            name,
        )
        return

    rate = get_currency_rate(currency, year)
    if rate is None:
        # Try adjacent years as fallback
        for offset in (1, -1, 2, -2):
            rate = get_currency_rate(currency, year + offset)
            if rate is not None:
                logger.warning(
                    "[PEER_RATING] '{}': no rate for {}/{}, using {}/{} (rate={})",
                    name, currency, year, currency, year + offset, rate,
                )
                break

    if rate is None:
        logger.warning(
            "[PEER_RATING] '{}': no USD rate for {}/{} – values left as-is (may skew scores)",
            name, currency, year,
        )
        # Still convert to millions as a best-effort
        for key in _FINANCIAL_KEYS:
            val = company.get(key)
            if val is not None:
                company[key] = val / 1_000_000
        return

    for key in _FINANCIAL_KEYS:
        val = company.get(key)
        if val is not None:
            company[key] = (val * rate) / 1_000_000

    logger.info(
        "[PEER_RATING] '{}': converted {}/{} → USDm (rate={})",
        name, currency, year, rate,
    )


# ---------------------------------------------------------------------------
# Summary generation
# ---------------------------------------------------------------------------

def _generate_summary(company_name: str, scores: list[dict], overall: float) -> str:
    """Generate a concise AI summary for the company's peer rating."""
    strengths = sorted(scores, key=lambda s: s["score"], reverse=True)[:3]
    weaknesses = sorted(scores, key=lambda s: s["score"])[:2]

    strength_text = ", ".join(f"{s['criterion']} ({s['score']})" for s in strengths)
    weakness_text = ", ".join(f"{s['criterion']} ({s['score']})" for s in weaknesses)

    recommendation = (
        "proceed with enhanced due diligence" if overall >= 2.5
        else "caution advised"
    )
    return (
        f"{strength_text} are key strengths. "
        f"{weakness_text} are primary discounts. "
        f"Recommend {recommendation}."
    )


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

def _summarise_management(team: list) -> str:
    if not team:
        return "No management data available."
    parts = [f"{m.get('name', 'Unknown')} ({m.get('position', '')})" for m in team[:4]]
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


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def run_peer_rating(
    analysis_data: dict,
    peer_analyses: list[dict],
) -> dict:
    """
    Orchestrate the full peer rating pipeline.

    Args:
        analysis_data: The existing analysis dict for the target company.
        peer_analyses:  List of analysis dicts for selected peer companies.

    Returns:
        dict with keys: target_company, companies, scores, overall_scores,
        summaries.
    """
    company_name = analysis_data.get("company_name", "Unknown")
    logger.info("[PEER_RATING] Starting peer rating for '{}'", company_name)

    # 1. Extract target + peer data
    target = _extract_company_data(analysis_data)
    _enrich_management(target, analysis_data)
    logger.info("[PEER_RATING] Target extracted: {}", target["company_name"])

    all_companies = [target]
    for p_analysis in peer_analyses:
        p_data = _extract_company_data(p_analysis)
        _enrich_management(p_data, p_analysis)
        all_companies.append(p_data)
        logger.info("[PEER_RATING] Peer extracted: {}", p_data["company_name"])

    logger.info("[PEER_RATING] {} companies total", len(all_companies))

    # 2. Convert financial metrics to USD millions
    for c in all_companies:
        _convert_to_usd(c)

    # 3. Run scoring (companies now have USDm values)
    scoring_result = compute_all_scores(all_companies)

    # 4. Generate summaries
    summaries: dict[str, str] = {}
    for name, scores in scoring_result["scores"].items():
        overall = scoring_result["overall_scores"].get(name, 3.0)
        summaries[name] = _generate_summary(name, scores, overall)

    # 5. Build clean result for frontend
    clean_companies: list[dict] = []
    for c in all_companies:
        clean: dict = {
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
        # ROE for display (already in USDm so ratio is currency-neutral)
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

    logger.info(
        "[PEER_RATING] Pipeline complete for '{}'. Overall: {}",
        company_name, scoring_result["overall_scores"],
    )
    return result
