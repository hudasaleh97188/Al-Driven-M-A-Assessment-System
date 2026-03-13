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


def compute_ratios_from_metrics(metrics: dict) -> dict:
    """
    Compute derived ratios from the normalized metrics dict.
    Returns a dict of computed ratio name -> value.
    """
    pat = metrics.get('pat')
    total_operating_revenue = metrics.get('total_operating_revenue')
    total_equity = metrics.get('total_equity')
    total_assets = metrics.get('total_assets')
    total_liabilities = metrics.get('total_liabilities')
    op_expenses = metrics.get('total_operating_expenses')
    net_interests = metrics.get('net_interests')
    gross_loans = metrics.get('gross_loan_portfolio')
    gnpa_val = metrics.get('gross_non_performing_loans')
    provisions = metrics.get('total_loan_loss_provisions')
    debts_clients = metrics.get('debts_to_clients')
    debts_fi = metrics.get('debts_to_financial_institutions')
    arrears_30 = metrics.get('loans_with_arrears_over_30_days')
    ebitda = metrics.get('ebitda')

    result = {}

    # ROA %
    roa = safe_divide(pat, total_assets)
    if roa is not None:
        result['roa_percent'] = round(roa * 100, 2)

    # ROE %
    roe = safe_divide(pat, total_equity)
    if roe is not None:
        result['roe_percent'] = round(roe * 100, 2)

    # Profit Margin %
    pm = safe_divide(pat, total_operating_revenue)
    if pm is not None:
        result['profit_margin_percent'] = round(pm * 100, 2)

    # Cost to Income Ratio %
    cti = safe_divide(op_expenses, total_operating_revenue)
    if cti is not None:
        result['cost_to_income_ratio_percent'] = round(cti * 100, 2)

    # Net Interest Margin %
    nim = safe_divide(net_interests, gross_loans)
    if nim is not None:
        result['nim_percent'] = round(nim * 100, 2)

    # Deposits to Assets Ratio %
    dta = safe_divide(debts_clients, total_assets)
    if dta is not None:
        result['deposits_to_assets_percent'] = round(dta * 100, 2)

    # Loan-to-Deposit Ratio (LDR) %
    ldr = safe_divide(gross_loans, debts_clients)
    if ldr is not None:
        result['loan_to_deposit_percent'] = round(ldr * 100, 2)

    # Loans-to-Assets Ratio (LAR) %
    lar = safe_divide(gross_loans, total_assets)
    if lar is not None:
        result['loans_to_assets_percent'] = round(lar * 100, 2)

    # Non-Performing Loan Ratio (NPL) %
    npl = safe_divide(gnpa_val, gross_loans)
    if npl is not None:
        result['npl_percent'] = round(npl * 100, 2)

    # Provision Coverage Ratio (PCR) %
    pcr = safe_divide(provisions, gnpa_val)
    if pcr is not None:
        result['provision_coverage_percent'] = round(pcr * 100, 2)

    # Capital Adequacy Ratio (simplified: equity / total_assets)
    car = safe_divide(total_equity, total_assets)
    if car is not None:
        result['capital_adequacy_percent'] = round(car * 100, 2)

    # Interest Coverage Ratio
    if net_interests and op_expenses and op_expenses != 0:
        icr = net_interests / abs(op_expenses) if op_expenses else None
        if icr is not None:
            result['interest_coverage_ratio'] = round(icr, 2)

    # Depositors vs Borrowers Ratio
    dep_borr = safe_divide(debts_clients, debts_fi)
    if dep_borr is not None:
        result['depositors_vs_borrowers_ratio'] = round(dep_borr, 2)

    # PAR 30 %
    par30 = safe_divide(arrears_30, gross_loans)
    if par30 is not None:
        result['par_30_percent'] = round(par30 * 100, 2)

    # Equity to GLP %
    eq_glp = safe_divide(total_equity, gross_loans)
    if eq_glp is not None:
        result['equity_to_glp_percent'] = round(eq_glp * 100, 2)

    return result


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
