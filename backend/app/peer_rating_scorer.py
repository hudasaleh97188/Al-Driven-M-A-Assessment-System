"""
peer_rating_scorer.py
---------------------
Scoring engine for the 9 M&A attractiveness criteria (scale 1–5).

Architecture:
  Criteria 1, 2, 3, 5  → deterministic (absolute thresholds on USD values).
  Criteria 4, 6, 7, 8, 9 → single LLM call (qualitative only).

Currency conversion is performed BEFORE this module is called.
The ``companies`` list received by ``compute_all_scores()`` already has
``pat``, ``total_equity``, and ``gross_loan_portfolio`` in **USD millions**.
"""

from __future__ import annotations

import json
import re
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


def _norm_name(s: str) -> str:
    """Normalise a company name for fuzzy matching."""
    return re.sub(r"\s+", " ", s.strip().lower())


# ---------------------------------------------------------------------------
# Criterion 1: Contribution to Profitability  (deterministic)
# ---------------------------------------------------------------------------

def score_profitability(companies: list[dict]) -> dict[str, dict]:
    """
    Absolute-based 1-5 scoring using PAT (USDm) and ROE (%).
    """
    results: dict[str, dict] = {}

    for c in companies:
        name = c["company_name"]
        sub_scores: list[dict] = []
        raw_scores: list[int] = []

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
# Criterion 2: Size of Transaction  (deterministic)
# ---------------------------------------------------------------------------

def score_transaction_size(companies: list[dict]) -> dict[str, dict]:
    """
    Absolute-based 1-5 scoring using GLP (USDm), Equity (USDm), and
    geographic reach.
    """
    results: dict[str, dict] = {}

    for c in companies:
        name = c["company_name"]
        sub_scores: list[dict] = []
        raw_scores: list[int] = []

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
# Criterion 3: Geographic / Strategic Country Fit  (deterministic)
# ---------------------------------------------------------------------------

def _parse_population(text: str) -> int:
    """Score population: <53M → 1, <79M → 2, <139M → 3, else 4."""
    try:
        match = re.search(r"([\d.]+)\s*million", text, re.IGNORECASE)
        if match:
            pop_m = float(match.group(1))
            if pop_m < 53:
                return 1
            if pop_m < 79:
                return 2
            if pop_m < 139:
                return 3
            return 4
    except Exception:
        pass
    return 1


def _parse_risk(text: str) -> int:
    """Score country risk: VH → 1, H → 2, MH → 3, M/ML/L → 4."""
    t = str(text).lower()
    if "very high" in t or "vh" in t:
        return 1
    if "moderate-high" in t or "mh" in t:
        return 3
    if "high" in t or "h" in t:
        return 2
    if "moderate-low" in t or "ml" in t:
        return 4
    if "moderate" in t or "m" in t:
        return 4
    if "low" in t or "l" in t:
        return 4
    return 1


def _parse_cpi(text: str) -> int:
    """Score CPI: <26 → 1, <34 → 2, <37 → 3, else 4."""
    try:
        match = re.search(r"score\s*([\d.]+)", text, re.IGNORECASE)
        if match:
            cpi = float(match.group(1))
        else:
            nums = re.findall(r"\b(\d+)\b", text)
            cpi = float(nums[-1]) if nums else None
        if cpi is not None:
            if cpi < 26:
                return 1
            if cpi < 34:
                return 2
            if cpi < 37:
                return 3
            return 4
    except Exception:
        pass
    return 1


def _parse_gdp_growth(text: str) -> int:
    """Score GDP growth: <2.7% → 1, <4.6% → 2, <6.2% → 3, else 4."""
    try:
        match = re.search(r"([\d.]+)\s*%", text)
        if match:
            gdp = float(match.group(1))
            if gdp < 2.7:
                return 1
            if gdp < 4.6:
                return 2
            if gdp < 6.2:
                return 3
            return 4
    except Exception:
        pass
    return 1


def score_geographic_fit(companies: list[dict]) -> dict[str, dict]:
    """
    Deterministic scoring from macroeconomic indicators per country.
    Final score = max(country averages).
    """
    results: dict[str, dict] = {}

    for c in companies:
        name = c["company_name"]
        geo_view = c.get("macroeconomic_geo_view") or []

        if not geo_view:
            logger.warning("[SCORE] Geographic   '{}': no macro data → default 1", name)
            results[name] = {
                "criterion": "Geographic / Strategic Fit",
                "score": 1,
                "sub_scores": [],
                "justification": "No macroeconomic data available to score.",
            }
            continue

        country_avgs: list[float] = []
        all_sub: list[dict] = []

        for g in geo_view:
            country_name = g.get("country", "Unknown")
            p = _parse_population(g.get("population", ""))
            gd = _parse_gdp_growth(g.get("gdp_growth_forecast", ""))
            r = _parse_risk(g.get("country_risk_rating", ""))
            cp = _parse_cpi(g.get("corruption_perceptions_index_rank", ""))

            avg = round((p + gd + r + cp) / 4.0, 2)
            country_avgs.append(avg)
            all_sub.append({
                "metric": country_name,
                "value": f"Pop:{p} Growth:{gd} Risk:{r} CPI:{cp} → Avg {avg:.2f}",
                "score": int(round(avg)),
            })

        max_avg = max(country_avgs) if country_avgs else 1.0
        final_score = int(round(max_avg))
        logger.info(
            "[SCORE] Geographic   '{}': {} countries → max_avg={}",
            name, len(country_avgs), max_avg,
        )

        results[name] = {
            "criterion": "Geographic / Strategic Fit",
            "score": final_score,
            "sub_scores": all_sub,
            "justification": f"Best country index ({max_avg:.2f} avg across 4 macroeconomic metrics).",
        }

    return results


# ---------------------------------------------------------------------------
# Criterion 5: Ease of Execution  (deterministic)
# ---------------------------------------------------------------------------

def score_ease_of_execution(companies: list[dict]) -> dict[str, dict]:
    """
    Deterministic 1-5 scoring using listing status and shareholder
    concentration.
    """
    results: dict[str, dict] = {}

    for c in companies:
        name = c["company_name"]
        sub_scores: list[dict] = []
        raw_scores: list[int] = []

        # Listing sub-score
        is_public = c.get("is_publicly_listed")
        if is_public is not None:
            listing_score = 3 if is_public else 5
            sub_scores.append({
                "metric": "Listing Status",
                "value": "Public" if is_public else "Private",
                "score": listing_score,
            })
            raw_scores.append(listing_score)

        # Concentration sub-score
        shareholders = c.get("shareholders", [])
        if shareholders:
            sorted_sh = sorted(
                [s for s in shareholders if s.get("percentage") is not None],
                key=lambda s: s.get("percentage", 0),
                reverse=True,
            )
            if sorted_sh and sorted_sh[0].get("percentage", 0) > 80:
                conc_score = 5
            elif len(sorted_sh) >= 2 and sum(s.get("percentage", 0) for s in sorted_sh[:2]) > 50:
                conc_score = 4
            elif len(sorted_sh) >= 3 and sum(s.get("percentage", 0) for s in sorted_sh[:3]) > 50:
                conc_score = 2
            else:
                conc_score = 2

            top_names = ", ".join(
                f"{s.get('name', '?')} ({s.get('percentage', '?')}%)"
                for s in sorted_sh[:3]
            )
            sub_scores.append({
                "metric": "Shareholder Concentration",
                "value": top_names,
                "score": conc_score,
            })
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
# LLM-evaluated criteria (4, 6, 7, 8, 9) — single call, qualitative only
# ---------------------------------------------------------------------------

def _get_client() -> genai.Client:
    return genai.Client(
        vertexai=True, project=GCP_PROJECT_ID, location=VERTEX_LOCATION
    )


def _build_qualitative_data_for_llm(companies: list[dict]) -> list[dict]:
    """
    Build a slimmed-down view with ONLY the qualitative fields the LLM
    rubrics reference.  No financial numbers, no currency, no PAT/equity/GLP.
    """
    slim: list[dict] = []
    for c in companies:
        slim.append({
            "company_name": c["company_name"],
            # Criterion 4: Product / Market Strategy Fit
            "products_and_services": c.get("products_and_services", ""),
            "countries_of_operation": c.get("countries_of_operation", []),
            # Criterion 6: Quality & Depth of Management
            "management_team": c.get("management_team", []),
            # Criterion 7: Strategic Partners
            "strategic_partners": c.get("strategic_partners", []),
            # Criterion 8: Quality of IT & Data
            "it_details": c.get("it_details", {}),
            # Criterion 9: Competitor Positioning
            "competitive_position": c.get("competitive_position", {}),
        })
    return slim


LLM_CRITERION_NAMES = [
    "Product / Market Strategy Fit",
    "Quality & Depth of Management",
    "Strategic Partners",
    "Quality of IT & Data",
    "Competitor Positioning",
]


def score_all_llm_criteria(companies: list[dict]) -> dict[str, dict]:
    """
    Score all companies on the 5 qualitative LLM criteria in a single call.
    Returns ``{company_name: {"criteria_scores": [...]}, ...}``.
    """
    client = _get_client()

    slim_data = _build_qualitative_data_for_llm(companies)
    prompt = build_all_criteria_scoring_prompt(slim_data)

    logger.info(
        "[PEER_SCORING] LLM qualitative scoring call for {} companies, 5 criteria",
        len(companies),
    )
    logger.debug("[PEER_SCORING] Prompt:\n{}", prompt)

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
        return _fallback_scores(companies)

    logger.debug("[PEER_SCORING] LLM response:\n{}", response.text)

    try:
        data = json.loads(response.text)
    except json.JSONDecodeError:
        logger.error("[PEER_SCORING] Failed to parse LLM scoring response")
        return _fallback_scores(companies)

    return _parse_llm_scores(data, companies)


def _fallback_scores(companies: list[dict]) -> dict[str, dict]:
    """Return default score 3 for all criteria when LLM fails."""
    fallback: dict[str, dict] = {}
    for c in companies:
        fallback[c["company_name"]] = {
            "criteria_scores": [
                {"criterion": crit, "score": 3, "justification": "LLM scoring unavailable – default."}
                for crit in LLM_CRITERION_NAMES
            ]
        }
    return fallback


def _parse_llm_scores(data: dict, companies: list[dict]) -> dict[str, dict]:
    """Parse the LLM JSON response into the expected structure."""
    results: dict[str, dict] = {
        c["company_name"]: {"criteria_scores": []} for c in companies
    }
    norm_lookup = {_norm_name(name): name for name in results}

    for entry in data.get("company_scores", []):
        raw_name = entry.get("company_name", "")
        matched = results.get(raw_name) and raw_name
        if not matched:
            matched = norm_lookup.get(_norm_name(raw_name))
        if not matched:
            logger.warning("[PEER_SCORING] LLM returned unknown company '{}', skipping", raw_name)
            continue

        logger.info("[PEER_SCORING] Matched LLM company '{}' → '{}'", raw_name, matched)
        results[matched] = {"criteria_scores": []}
        for crit_entry in entry.get("criteria", []):
            results[matched]["criteria_scores"].append({
                "criterion": crit_entry.get("criterion", ""),
                "score": max(1, min(5, crit_entry.get("score", 3))),
                "justification": crit_entry.get("justification", ""),
            })

    # Back-fill any missing criteria
    for c in companies:
        name = c["company_name"]
        if name not in results or "criteria_scores" not in results[name]:
            results[name] = {"criteria_scores": []}
        scored = {s["criterion"] for s in results[name]["criteria_scores"]}
        for crit in LLM_CRITERION_NAMES:
            if crit not in scored:
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
    Compute all 9 criteria scores for every company.

    **Pre-condition**: ``pat``, ``total_equity``, and ``gross_loan_portfolio``
    on each company dict are already in USD millions (converted by the
    caller using ``currency_rates.rate_to_usd``).

    Returns::

        {
            "scores":         {company_name: [CriterionScore, ...]},
            "overall_scores": {company_name: float},
        }
    """
    logger.info("[PEER_SCORING] Computing scores for {} companies", len(companies))

    all_scores: dict[str, list[dict]] = {c["company_name"]: [] for c in companies}

    # ── Deterministic criteria ─────────────────────────────────────────────
    for scorer, label in [
        (score_profitability,     "Profitability"),
        (score_transaction_size,  "Transaction Size"),
        (score_geographic_fit,    "Geographic Fit"),
        (score_ease_of_execution, "Ease of Execution"),
    ]:
        results = scorer(companies)
        for name, result in results.items():
            all_scores[name].append(result)
        logger.info("[PEER_SCORING] ✓ {} scores computed", label)

    # ── LLM qualitative criteria (single call) ────────────────────────────
    llm_results = score_all_llm_criteria(companies)
    for name, company_llm_data in llm_results.items():
        if name in all_scores:
            all_scores[name].extend(company_llm_data.get("criteria_scores", []))
    logger.info("[PEER_SCORING] ✓ LLM qualitative criteria computed")

    # ── Log full breakdown ─────────────────────────────────────────────────
    for name, scores in all_scores.items():
        for s in scores:
            logger.info(
                "[PEER_SCORING] {} | {:40s} → {}",
                name, s["criterion"], s["score"],
            )

    # ── Overall scores (simple average — weights applied in UI) ────────────
    overall_scores: dict[str, float] = {}
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
