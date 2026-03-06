"""
ratios.py
---------
Pure-Python helpers that compute derived financial ratios from raw extracted values.
These are applied after Stage 1 extraction and before writing to the database.
"""

from typing import Optional


def safe_divide(num: Optional[float], den: Optional[float]) -> Optional[float]:
    """Return num / den, or None if either value is missing or denominator is zero."""
    if num is not None and den is not None and den != 0:
        return num / den
    return None


def compute_ratios(financial_health: dict, prev_fh: Optional[dict] = None) -> dict:
    """
    Compute all derived ratios and inject them into the financial_health dict.
    Mutates the dict in-place AND returns it for convenience.

    Ratios added
    ────────────
    profit_margin_percent       = PAT / Revenue × 100
    roe_percent                 = PAT / Average Total Equity × 100
    roa_percent                 = PAT / Average Total Assets × 100
    cost_to_income_ratio_percent= OpEx / Revenue × 100
    nim_percent                 = Net Interests / Gross Loan Portfolio × 100
    par_30_percent              = Arrears >30d / Gross Loan Portfolio × 100
    gnpa_percent                = Gross NPL / Gross Loan Portfolio × 100
    provision_coverage_percent  = Provisions / Gross Loan Portfolio × 100
    equity_to_glp_percent       = Total Equity / Gross Loan Portfolio × 100
    depositors_vs_borrowers_ratio = Debts to Clients / Debts to FIs (string, 2dp)
    """
    fh = financial_health  # alias for brevity

    pat                     = fh.get("pat")
    total_operating_revenue = fh.get("total_operating_revenue")
    total_equity            = fh.get("total_equity")
    total_assets   = fh.get("total_assets")
    op_expenses    = fh.get("total_operating_expenses")
    net_interests  = fh.get("net_interests")
    gross_loans    = fh.get("gross_loan_portfolio")
    arrears_30     = fh.get("loans_with_arrears_over_30_days")
    gnpa_val       = fh.get("gross_non_performing_loans")
    provisions     = fh.get("total_loan_loss_provisions")

    debts_clients  = fh.get("debts_to_clients")
    debts_fi       = fh.get("debts_to_financial_institutions")

    avg_total_assets = total_assets
    if total_assets is not None and prev_fh and prev_fh.get("total_assets") is not None:
        avg_total_assets = (total_assets + prev_fh.get("total_assets")) / 2.0

    avg_total_equity = total_equity
    if total_equity is not None and prev_fh and prev_fh.get("total_equity") is not None:
        avg_total_equity = (total_equity + prev_fh.get("total_equity")) / 2.0

    def _set(key: str, value: Optional[float], pct: bool = True, dp: int = 2) -> None:
        if value is not None:
            fh[key] = round(value * (100 if pct else 1), dp)

    _set("profit_margin_percent",         safe_divide(pat, total_operating_revenue))
    _set("roe_percent",                   safe_divide(pat, avg_total_equity))
    _set("roa_percent",                   safe_divide(pat, avg_total_assets))
    _set("cost_to_income_ratio_percent",  safe_divide(op_expenses, total_operating_revenue))
    _set("nim_percent",                   safe_divide(net_interests, gross_loans))
    _set("par_30_percent",                safe_divide(arrears_30, gross_loans))
    _set("gnpa_percent",                  safe_divide(gnpa_val, gross_loans))
    _set("provision_coverage_percent",    safe_divide(provisions, gross_loans))
    _set("equity_to_glp_percent",         safe_divide(total_equity, gross_loans))

    dep_borr = safe_divide(debts_clients, debts_fi)
    if dep_borr is not None:
        fh["depositors_vs_borrowers_ratio"] = round(dep_borr, 2)

    return fh


def enrich_financial_data(financial_data: list) -> list:
    """Apply compute_ratios to every year block in the financial_data array sequentially."""
    try:
        financial_data.sort(key=lambda x: int(x.get("year", 0)))
    except Exception:
        pass

    prev_fh = None
    for year_block in financial_data:
        fh = year_block.get("financial_health")
        if isinstance(fh, dict):
            year_block["financial_health"] = compute_ratios(fh, prev_fh)
            prev_fh = year_block["financial_health"]
    return financial_data
