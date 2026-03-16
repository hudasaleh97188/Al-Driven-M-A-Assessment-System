/**
 * computeRatios.ts
 * ----------------
 * Single source of truth for all derived financial ratios.
 *
 * Used by both FinancialHealth.tsx and RatingComparison.tsx.
 * The backend stores only raw extracted metrics; all ratios are
 * computed client-side by this function.
 */

/** Shape of the raw metric map coming from the DB (metric_name → value). */
export interface RawMetrics {
  pat?: number | null;
  total_operating_revenue?: number | null;
  total_equity?: number | null;
  total_assets?: number | null;
  total_liabilities?: number | null;
  total_operating_expenses?: number | null;
  net_interests?: number | null;
  gross_loan_portfolio?: number | null;
  gross_non_performing_loans?: number | null;
  total_loan_loss_provisions?: number | null;
  debts_to_clients?: number | null;
  debts_to_financial_institutions?: number | null;
  loans_with_arrears_over_30_days?: number | null;
  ebitda?: number | null;
  disbursals?: number | null;
  [key: string]: number | string | null | undefined;
}

/** All computed ratios returned by `computeRatios`. */
export interface ComputedRatios {
  profit_margin_percent?: number;
  roe_percent?: number;
  roa_percent?: number;
  cost_to_income_ratio_percent?: number;
  nim_percent?: number;
  par_30_percent?: number;
  gnpa_percent?: number;
  provision_coverage_percent?: number;
  equity_to_glp_percent?: number;
  depositors_vs_borrowers_ratio?: number;
  deposits_to_assets_percent?: number;
  loan_to_deposit_percent?: number;
  loans_to_assets_percent?: number;
  npl_percent?: number;
  capital_adequacy_percent?: number;
  interest_coverage_ratio?: number;
  [key: string]: number | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeDivide(num?: number | null, den?: number | null): number | undefined {
  if (num != null && den != null && den !== 0) {
    return num / den;
  }
  return undefined;
}

function pct(ratio: number | undefined, dp = 2): number | undefined {
  return ratio !== undefined ? parseFloat((ratio * 100).toFixed(dp)) : undefined;
}

function round2(val: number | undefined): number | undefined {
  return val !== undefined ? parseFloat(val.toFixed(2)) : undefined;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Compute all derived financial ratios from raw metrics.
 *
 * @param metrics     Current-year raw metrics.
 * @param prevMetrics Previous-year raw metrics (optional, used for
 *                    average-based ratios like ROA and ROE).
 */
export function computeRatios(
  metrics: RawMetrics,
  prevMetrics?: RawMetrics | null,
): ComputedRatios {
  const pat = metrics.pat as number | null | undefined;
  const totalOperatingRevenue = metrics.total_operating_revenue as number | null | undefined;
  const totalEquity = metrics.total_equity as number | null | undefined;
  const totalAssets = metrics.total_assets as number | null | undefined;
  const opExpenses = metrics.total_operating_expenses as number | null | undefined;
  const netInterests = metrics.net_interests as number | null | undefined;
  const grossLoans = metrics.gross_loan_portfolio as number | null | undefined;
  const gnpaVal = metrics.gross_non_performing_loans as number | null | undefined;
  const provisions = metrics.total_loan_loss_provisions as number | null | undefined;
  const debtsClients = metrics.debts_to_clients as number | null | undefined;
  const debtsFi = metrics.debts_to_financial_institutions as number | null | undefined;
  const arrears30 = metrics.loans_with_arrears_over_30_days as number | null | undefined;

  // Average-based denominators (use average of current + previous year if available)
  let avgTotalAssets = totalAssets;
  if (totalAssets != null && prevMetrics?.total_assets != null) {
    avgTotalAssets = (totalAssets + (prevMetrics.total_assets as number)) / 2;
  }

  let avgTotalEquity = totalEquity;
  if (totalEquity != null && prevMetrics?.total_equity != null) {
    avgTotalEquity = (totalEquity + (prevMetrics.total_equity as number)) / 2;
  }

  const result: ComputedRatios = {};

  // Profitability ratios
  result.profit_margin_percent = pct(safeDivide(pat, totalOperatingRevenue));
  result.roe_percent = pct(safeDivide(pat, avgTotalEquity));
  result.roa_percent = pct(safeDivide(pat, avgTotalAssets));

  // Efficiency
  result.cost_to_income_ratio_percent = pct(safeDivide(opExpenses, totalOperatingRevenue));

  // Net Interest Margin
  result.nim_percent = pct(safeDivide(netInterests, grossLoans));

  // Asset quality
  result.par_30_percent = pct(safeDivide(arrears30, grossLoans));
  result.gnpa_percent = pct(safeDivide(gnpaVal, grossLoans));
  result.npl_percent = pct(safeDivide(gnpaVal, grossLoans));

  // Provision coverage (provisions / NPL)
  result.provision_coverage_percent = pct(safeDivide(provisions, gnpaVal));

  // Capital / solvency
  result.equity_to_glp_percent = pct(safeDivide(totalEquity, grossLoans));
  result.capital_adequacy_percent = pct(safeDivide(totalEquity, totalAssets));

  // Funding structure
  result.deposits_to_assets_percent = pct(safeDivide(debtsClients, totalAssets));
  result.loan_to_deposit_percent = pct(safeDivide(grossLoans, debtsClients));
  result.loans_to_assets_percent = pct(safeDivide(grossLoans, totalAssets));

  // Depositors vs Borrowers
  result.depositors_vs_borrowers_ratio = round2(safeDivide(debtsClients, debtsFi));

  // Interest coverage
  if (netInterests != null && opExpenses != null && opExpenses !== 0) {
    result.interest_coverage_ratio = round2(netInterests / Math.abs(opExpenses));
  }

  // Strip undefined keys for cleaner JSON
  for (const key of Object.keys(result)) {
    if (result[key] === undefined) {
      delete result[key];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Display formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format a large number for display using K / M / B suffixes.
 * E.g. 24690000 → "24.69M"
 */
export function formatCompact(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "N/A";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(decimals)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(decimals)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(decimals)}K`;
  return `${sign}${abs.toFixed(decimals)}`;
}
