"""
peer_rating_scorer.py
---------------------
Scoring engine for the 9 M&A attractiveness criteria (scale 1–5).

Criteria 1–2: deterministic (absolute thresholds).
Criterion 3:  commented-out (awaiting strategic-country input).
Criterion 5:  deterministic (listing + shareholder concentration).
Criteria 4, 6–9: single LLM call with rubrics.
"""

import json
import traceback
from typing import Optional

from google import genai
from google.genai import types
from loguru import logger

from app.config import GCP_PROJECT_ID, VERTEX_LOCATION
from app.peer_rating_schemas import ALL_LLM_SCORING_SCHEMA
from app.peer_rating_prompts import build_all_criteria_scoring_prompt


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe_val(v) -> Optional[float]:
    """Safely convert a value to float, return None if not possible."""
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Criterion 1: Contribution to Profitability
# ---------------------------------------------------------------------------

def score_profitability(companies: list[dict]) -> dict[str, dict]:
    """
    Absolute-based 1-5 scoring using PAT and ROE.
    Returns {company_name: {criterion, score, sub_scores}}.
    """
    results = {}

    for c in companies:
        name = c["company_name"]
        sub_scores = []
        raw_scores = []

        pat = _safe_val(c.get("pat"))
        equity = _safe_val(c.get("total_equity"))
        roe = (pat / equity * 100) if (pat is not None and equity and equity != 0) else None

        if pat is not None:
            if pat > 20:
                s = 5
            elif pat >= 10:
                s = 4
            elif pat >= 5:
                s = 3
            elif pat >= 0:
                s = 2
            else:
                s = 1
            sub_scores.append({"metric": "PAT (USDm)", "value": round(pat, 2), "score": s})
            raw_scores.append(s)

        if roe is not None:
            if roe > 20:
                s = 5
            elif roe >= 10:
                s = 3
            else:
                s = 1
            sub_scores.append({"metric": "ROE (%)", "value": round(roe, 2), "score": s})
            raw_scores.append(s)

        score = round(sum(raw_scores) / len(raw_scores)) if raw_scores else 3
        logger.info("[SCORE] Profitability  '{}': sub={} → final={}", name, raw_scores, score)
        results[name] = {
            "criterion": "Contribution to Profitability",
            "score": score,
            "sub_scores": sub_scores,
        }

    return results


# ---------------------------------------------------------------------------
# Criterion 2: Size of Transaction
# ---------------------------------------------------------------------------

def score_transaction_size(companies: list[dict]) -> dict[str, dict]:
    """
    Absolute-based 1-5 scoring using Gross Loan Portfolio, Equity, and Geographic Reach.
    """
    results = {}

    for c in companies:
        name = c["company_name"]
        sub_scores = []
        raw_scores = []

        glp = _safe_val(c.get("gross_loan_portfolio"))
        equity = _safe_val(c.get("total_equity"))
        countries = len(c.get("countries_of_operation", []))

        if glp is not None:
            if glp > 500:
                s = 5
            elif glp >= 300:
                s = 4
            elif glp >= 100:
                s = 3
            elif glp >= 50:
                s = 2
            else:
                s = 1
            sub_scores.append({"metric": "Gross Loan Portfolio (USDm)", "value": round(glp, 2), "score": s})
            raw_scores.append(s)

        if equity is not None:
            if equity > 150:
                s = 5
            elif equity >= 100:
                s = 4
            elif equity >= 50:
                s = 3
            else:
                s = 2
            sub_scores.append({"metric": "Equity (USDm)", "value": round(equity, 2), "score": s})
            raw_scores.append(s)

        if countries > 0:
            if countries > 3:
                s = 5
            elif countries >= 2:
                s = 4
            else:
                s = 3
            sub_scores.append({"metric": "Geographic Reach", "value": countries, "score": s})
            raw_scores.append(s)

        score = round(sum(raw_scores) / len(raw_scores)) if raw_scores else 3
        logger.info("[SCORE] Transaction   '{}': sub={} → final={}", name, raw_scores, score)
        results[name] = {
            "criterion": "Size of Transaction",
            "score": score,
            "sub_scores": sub_scores,
        }

    return results


# ---------------------------------------------------------------------------
# Criterion 3: Geographic / Strategic Country Fit
# ---------------------------------------------------------------------------

import re

def _parse_population(text: str) -> int:
    # IF(Population (in millian)<53,1,IF(Population in millian <79,2,IF(Population in millian <139,3,4)))
    try:
        match = re.search(r'([\d.]+)\s*million', text, re.IGNORECASE)
        if match:
            pop_m = float(match.group(1))
            if pop_m < 53: return 1
            if pop_m < 79: return 2
            if pop_m < 139: return 3
            return 4
    except Exception:
        pass
    return 1

def _parse_risk(text: str) -> int:
    # IFS(Risk Score="L",4,Risk Score="ML",4,Risk Score="M",4,Risk Score="MH",3,Risk Score="H",2,Risk Score="VH",1)
    t = str(text).lower()
    if "very high" in t or "vh" in t: return 1
    if "moderate-high" in t or "mh" in t: return 3
    if "high" in t or "h" in t: return 2
    if "moderate-low" in t or "ml" in t: return 4
    if "moderate" in t or "m" in t: return 4
    if "low" in t or "l" in t: return 4
    return 1

def _parse_cpi(text: str) -> int:
    # IF(CPI score<26,1,IF(CPI score<34,2,IF(CPI score<37,3,4)))
    # Format e.g. "82 (Score 41)", fallback: try to find "score NN"
    try:
        match = re.search(r'score\s*([\d.]+)', text, re.IGNORECASE)
        if match:
            cpi = float(match.group(1))
        else:
            nums = re.findall(r'\b(\d+)\b', text)
            if len(nums) >= 2:
                cpi = float(nums[-1])  # "82 (Score 41)" -> 41
            elif nums:
                cpi = float(nums[-1])
            else:
                return 1
                
        if cpi < 26: return 1
        if cpi < 34: return 2
        if cpi < 37: return 3
        return 4
    except Exception:
        pass
    return 1

def _parse_gdp_growth(text: str) -> int:
    # IF(GP growth<2.7%,1,IF(GP growth<4.6,2,IF(GP growth<6.2,3,4)))
    try:
        match = re.search(r'([\d.]+)\s*%', text)
        if match:
            gdp = float(match.group(1))
            if gdp < 2.7: return 1
            if gdp < 4.6: return 2
            if gdp < 6.2: return 3
            return 4
    except Exception:
        pass
    return 1


def score_geographic_fit(companies: list[dict]) -> dict[str, dict]:
    """
    Scores companies on Geographic / Strategic Country Fit (Criterion 3).

    Strategy:
      Parses the 4 macroeconomic indicators (Population, GDP Growth, Risk, CPI)
      using regex thresholds into individual integer scores.
      Averages these scores per country.
      Identifies the country with the maximum average as the final score. 
    """
    results = {}

    for c in companies:
        name = c["company_name"]
        geo_view = c.get("macroeconomic_geo_view", []) or []

        if not geo_view:
            logger.warning("[SCORE] Geographic   '{}': No countries in macroeconomic_geo_view → default 1", name)
            results[name] = {
                "criterion": "Geographic / Strategic Fit",
                "score": 1,
                "sub_scores": [],
                "justification": "No macroeconomic data available to score.",
            }
            continue

        country_avgs = []
        all_sub_scores = []

        for g in geo_view:
            country_name = g.get("country", "Unknown")
            pop_raw = g.get("population", "")
            gdp_raw = g.get("gdp_growth_forecast", "")
            risk_raw = g.get("country_risk_rating", "")
            cpi_raw = g.get("corruption_perceptions_index_rank", "")
            
            p_score = _parse_population(pop_raw)
            g_score = _parse_gdp_growth(gdp_raw)
            r_score = _parse_risk(risk_raw)
            c_score = _parse_cpi(cpi_raw)
            
            avg = round((p_score + g_score + r_score + c_score) / 4.0, 2)
            country_avgs.append(avg)
            
            all_sub_scores.append({
                "metric": country_name,
                "value": f"Pop:{p_score} Growth:{g_score} Risk:{r_score} CPI:{c_score} → Avg {avg:.2f}",
                "score": int(round(avg)),
            })

        max_avg = max(country_avgs) if country_avgs else 1.0
        final_score = int(round(max_avg))
        
        logger.info("[SCORE] Geographic   '{}': evaluated {} countries → max_avg={}", name, len(country_avgs), max_avg)

        results[name] = {
            "criterion": "Geographic / Strategic Fit",
            "score": final_score,
            "sub_scores": all_sub_scores,
            "justification": (
                f"Best country index ({max_avg:.2f} avg across 4 macroeconomic metrics)."
            ),
        }

    return results


# ---------------------------------------------------------------------------
# Criterion 5: Ease of Execution (deterministic)
# ---------------------------------------------------------------------------

def score_ease_of_execution(companies: list[dict]) -> dict[str, dict]:
    """
    Deterministic 1-5 scoring using listing status and shareholder concentration.
    """
    results = {}

    for c in companies:
        name = c["company_name"]
        sub_scores = []
        raw_scores = []

        # Listing sub-score
        is_public = c.get("is_publicly_listed")
        if is_public is not None:
            listing_score = 3 if is_public else 5
            sub_scores.append({"metric": "Listing Status", "value": "Public" if is_public else "Private", "score": listing_score})
            raw_scores.append(listing_score)

        # Concentration sub-score
        shareholders = c.get("shareholders", [])
        if shareholders:
            # Sort by percentage descending
            sorted_sh = sorted(
                [s for s in shareholders if s.get("percentage") is not None],
                key=lambda s: s.get("percentage", 0),
                reverse=True,
            )

            if sorted_sh and sorted_sh[0].get("percentage", 0) > 80:
                # Single shareholder >80%
                conc_score = 5
            elif len(sorted_sh) >= 2 and sum(s.get("percentage", 0) for s in sorted_sh[:2]) > 50:
                # Two shareholders >50%
                conc_score = 4
            elif len(sorted_sh) >= 3 and sum(s.get("percentage", 0) for s in sorted_sh[:3]) > 50:
                # Three+ shareholders >50%
                conc_score = 2
            else:
                conc_score = 2  # Default: dispersed

            top_names = ", ".join(f"{s.get('name', '?')} ({s.get('percentage', '?')}%)" for s in sorted_sh[:3])
            sub_scores.append({"metric": "Shareholder Concentration", "value": top_names, "score": conc_score})
            raw_scores.append(conc_score)

        score = round(sum(raw_scores) / len(raw_scores)) if raw_scores else 3
        logger.info("[SCORE] Ease of Exec  '{}': sub={} → final={}", name, raw_scores, score)
        results[name] = {
            "criterion": "Ease of Execution",
            "score": score,
            "sub_scores": sub_scores,
        }

    return results


# ---------------------------------------------------------------------------
# LLM-evaluated criteria (4, 6, 7, 8, 9) — single call
# ---------------------------------------------------------------------------

def _get_client():
    return genai.Client(vertexai=True, project=GCP_PROJECT_ID, location=VERTEX_LOCATION)


def _build_slim_data_for_llm(companies: list[dict]) -> list[dict]:
    """
    Build a slimmed-down view of company data with only the fields needed
    for LLM-evaluated criteria, to minimize token usage.
    """
    slim = []
    for c in companies:
        entry = {
            "company_name": c["company_name"],
            # Criterion 4: Product / Market Strategy Fit
            "products_and_services": c.get("products_and_services", ""),
            "countries_of_operation": c.get("countries_of_operation", []),
            "currency": c.get("currency", "USDm"),
            "pat": c.get("pat"),
            "total_equity": c.get("total_equity"),
            "gross_loan_portfolio": c.get("gross_loan_portfolio"),
            # Criterion 6: Quality & Depth of Management
            "management_team": c.get("management_team", []),
            # Criterion 7: Strategic Partners
            "strategic_partners": c.get("strategic_partners", []),
            # Criterion 8: Quality of IT & Data
            "it_details": c.get("it_details", {}),
            # Criterion 9: Competitor Positioning
            "competitive_position": c.get("competitive_position", {}),
            "gross_loan_portfolio": c.get("gross_loan_portfolio"),
        }
        slim.append(entry)
    return slim


def score_all_llm_criteria(companies: list[dict]) -> dict[str, list[dict]]:
    """
    Score all companies on ALL 5 LLM-evaluated criteria in a single call.
    Returns {company_name: [CriterionScore, ...]}.
    """
    client = _get_client()

    slim_data = _build_slim_data_for_llm(companies)
    prompt = build_all_criteria_scoring_prompt(slim_data)

    logger.info("[PEER_SCORING] Single LLM scoring call for {} companies, 5 criteria", len(companies))
    logger.debug("[PEER_SCORING] Prompt:\n{}", prompt)

    llm_criteria = [
        "Product / Market Strategy Fit",
        "Quality & Depth of Management",
        "Strategic Partners",
        "Quality of IT & Data",
        "Competitor Positioning",
    ]

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ALL_LLM_SCORING_SCHEMA,
                temperature=0,
            ),
        )
    except Exception:
        logger.error("[PEER_SCORING] LLM scoring failed:\n{}", traceback.format_exc())
        # Fallback: give everyone 3 on all criteria
        fallback = {}
        for c in companies:
            fallback[c["company_name"]] = {
                "criteria_scores": [
                    {"criterion": crit, "score": 3, "justification": "LLM scoring unavailable – default."}
                    for crit in llm_criteria
                ]
            }
        return fallback

    logger.debug("[PEER_SCORING] LLM response:\n{}", response.text)

    try:
        data = json.loads(response.text)
    except json.JSONDecodeError:
        logger.error("[PEER_SCORING] Failed to parse LLM scoring response")
        fallback = {}
        for c in companies:
            fallback[c["company_name"]] = {
                "criteria_scores": [
                    {"criterion": crit, "score": 3, "justification": "Parse error."}
                    for crit in llm_criteria
                ]
            }
        return fallback

    # Parse response: expect {company_scores: [{company_name, pat_usdm, total_equity_usdm, gross_loan_portfolio_usdm, criteria: [{criterion, score, justification}]}]}
    results: dict[str, dict] = {c["company_name"]: {"criteria_scores": []} for c in companies}

    # Build a normalized-name → actual-name lookup to handle whitespace/case mismatches
    import re
    def _norm(s: str) -> str:
        return re.sub(r"\s+", " ", s.strip().lower())

    norm_lookup = {_norm(name): name for name in results}
    logger.debug("[PEER_SCORING] Name lookup: {}", {k: v for k, v in norm_lookup.items()})

    for company_entry in data.get("company_scores", []):
        raw_name = company_entry.get("company_name", "")
        # Try exact match first, then normalized match
        if raw_name in results:
            matched_name = raw_name
        else:
            matched_name = norm_lookup.get(_norm(raw_name))
        if matched_name is None:
            logger.warning("[PEER_SCORING] LLM returned unknown company '{}' (normalized: '{}'), skipping", raw_name, _norm(raw_name))
            continue
        logger.info("[PEER_SCORING] Matched LLM company '{}' → '{}'", raw_name, matched_name)
        
        # Save converted USDm values
        results[matched_name] = {
            "criteria_scores": [],
            "pat_usdm": company_entry.get("pat_usdm"),
            "total_equity_usdm": company_entry.get("total_equity_usdm"),
            "gross_loan_portfolio_usdm": company_entry.get("gross_loan_portfolio_usdm"),
        }
        
        for crit_entry in company_entry.get("criteria", []):
            results[matched_name]["criteria_scores"].append({
                "criterion": crit_entry.get("criterion", ""),
                "score": max(1, min(5, crit_entry.get("score", 3))),
                "justification": crit_entry.get("justification", ""),
            })

    # Ensure all companies have scores for all criteria
    for c in companies:
        name = c["company_name"]
        
        if name not in results or not isinstance(results[name], dict) or "criteria_scores" not in results[name]:
            results[name] = {"criteria_scores": []}
            
        scored_criteria = {s["criterion"] for s in results[name]["criteria_scores"]}
        for crit in llm_criteria:
            if crit not in scored_criteria:
                results[name]["criteria_scores"].append({
                    "criterion": crit,
                    "score": 3,
                    "justification": "No LLM score returned.",
                })

    return results


# ---------------------------------------------------------------------------
# Master scoring function
# ---------------------------------------------------------------------------

ALL_CRITERIA = [
    "Contribution to Profitability",
    "Size of Transaction",
    "Geographic / Strategic Fit",
    "Product / Market Strategy Fit",
    "Ease of Execution",
    "Quality & Depth of Management",
    "Strategic Partners",
    "Quality of IT & Data",
    "Competitor Positioning",
]


def compute_all_scores(companies: list[dict]) -> dict:
    """
    Compute all criteria scores for all companies.

    Returns:
    {
        "scores": {company_name: [CriterionScore, ...]},
        "overall_scores": {company_name: float},
    }
    """
    logger.info("[PEER_SCORING] Computing scores for {} companies", len(companies))

    all_scores: dict[str, list[dict]] = {c["company_name"]: [] for c in companies}

    # ── LLM-evaluated criteria (single call) & Currency Conversion ──────────
    llm_results = score_all_llm_criteria(companies)
    for name, company_llm_data in llm_results.items():
        if name in all_scores:
            all_scores[name].extend(company_llm_data.get("criteria_scores", []))
            
    logger.info("[PEER_SCORING] ✓ LLM criteria scores computed")

    # Update deterministic metrics to USDm based on LLM output
    for c in companies:
        name = c["company_name"]
        if name in llm_results:
            llm_c = llm_results[name]
            if llm_c.get("pat_usdm") is not None:
                c["pat"] = llm_c["pat_usdm"]
            if llm_c.get("total_equity_usdm") is not None:
                c["total_equity"] = llm_c["total_equity_usdm"]
            if llm_c.get("gross_loan_portfolio_usdm") is not None:
                c["gross_loan_portfolio"] = llm_c["gross_loan_portfolio_usdm"]

    # ── Deterministic criteria ──────────────────────────────────────────────
    profitability = score_profitability(companies)
    for name, result in profitability.items():
        all_scores[name].append(result)
    logger.info("[PEER_SCORING] ✓ Profitability scores computed")

    transaction_size = score_transaction_size(companies)
    for name, result in transaction_size.items():
        all_scores[name].append(result)
    logger.info("[PEER_SCORING] ✓ Transaction Size scores computed")

    geographic = score_geographic_fit(companies)
    for name, result in geographic.items():
        all_scores[name].append(result)
    logger.info("[PEER_SCORING] ✓ Geographic Fit scores computed")

    ease_of_exec = score_ease_of_execution(companies)
    for name, result in ease_of_exec.items():
        all_scores[name].append(result)
    logger.info("[PEER_SCORING] ✓ Ease of Execution scores computed")

    # Log the full score breakdown per company
    for name, scores in all_scores.items():
        for s in scores:
            logger.info("[PEER_SCORING] {} | {:40s} → {}", name, s['criterion'], s['score'])

    # ── Overall scores (simple average, no weights — weights applied in UI) ─
    overall_scores = {}
    for name, scores in all_scores.items():
        if scores:
            avg = sum(s["score"] for s in scores) / len(scores)
            overall_scores[name] = round(avg, 2)
        else:
            overall_scores[name] = 3.0

    logger.info("[PEER_SCORING] Scoring complete. Overall: {}", overall_scores)

    return {
        "scores": all_scores,
        "overall_scores": overall_scores,
    }
