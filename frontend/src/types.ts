// TypeScript interfaces matching the backend data shapes

export interface CountryRevenue {
    country: string;
    total_operating_revenue?: number;
}

export interface ManagementMember {
    name: string;
    position: string;
}

export interface Shareholder {
    name: string;
    ownership_percentage?: number;
}

export interface OperationalScale {
    number_of_branches?: number;
    number_of_employees?: number;
    number_of_customers?: number;
}

export interface CompanyOverview {
    description_of_products_and_services?: string;
    countries_of_operation?: string[];
    management_team?: ManagementMember[];
    shareholder_structure?: Shareholder[];
    strategic_partners?: string[];
    revenue_by_country?: CountryRevenue[];
    operational_scale?: OperationalScale;
}

export interface FinancialHealth {
    total_operating_revenue?: number;
    ebitda?: number;
    pat?: number;
    total_assets?: number;
    total_operating_expenses?: number;
    net_interests?: number;
    gross_loan_portfolio?: number;
    loans_with_arrears_over_30_days?: number;
    gross_non_performing_loans?: number;
    total_loan_loss_provisions?: number;
    total_equity?: number;
    total_liabilities?: number;
    tier_1_capital?: number;
    risk_weighted_assets?: number;
    disbursals?: number;
    debts_to_clients?: number;
    debts_to_financial_institutions?: number;
    credit_rating?: string;
    // Computed ratios
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
    total_loan_outstanding?: number;

    // Grouped Line Items
    asset_line_items?: Array<{ item_name: string; value_reported: number }>;
    liabilities_line_items?: Array<{ item_name: string; value_reported: number }>;
    equity_line_items?: Array<{ item_name: string; value_reported: number }>;
    income_statement_line_items?: Array<{ item_name: string; value_reported: number }>;
}

export interface FinancialDataYear {
    year: number;
    financial_health: FinancialHealth;
}

export interface AnomalyRisk {
    category: string;
    description: string;
    severity_level: string;
    valuation_impact: string;
    negotiation_leverage: string;
}

export interface QualityOfIT {
    core_banking_systems?: string[];
    digital_channel_adoption?: string;
    system_upgrades?: string[];
    vendor_partnerships?: string[];
    cyber_incidents?: string[];
}

export interface GeoViewCountry {
    country: string;
    population?: string;
    gdp_per_capita_ppp?: string;
    gdp_growth_forecast?: string;
    inflation?: string;
    central_bank_interest_rate?: string;
    unemployment_rate?: string;
    country_risk_rating?: string;
    corruption_perceptions_index_rank?: string;
}

export interface CompetitivePosition {
    key_competitors?: string[];
    market_share_data?: string;
    central_bank_sector_reports_summary?: string;
    industry_studies_summary?: string;
    customer_growth_or_attrition_news?: string;
}

export interface ManagementQuality {
    name: string;
    position?: string;
    previous_experience?: string;
    tenure_history?: string;
}

// ── Normalized Financial Statement Types ──

export interface FinancialLineItem {
    id: number;
    statement_id: number;
    category: 'Asset' | 'Liability' | 'Equity' | 'Income';
    item_name: string;
    value_reported: number | null;
    sort_order: number;
    is_total: number;
    data_source: string;
}

export interface FinancialEdit {
    id: number;
    statement_id: number;
    line_item_id: number | null;
    metric_name: string | null;
    operation?: 'UPDATE' | 'ADD' | 'DELETE';
    item_name?: string | null;
    category?: 'Asset' | 'Liability' | 'Equity' | 'Income' | null;
    old_value: number;
    new_value: number;
    comment: string;
    username: string | null;
    edited_at: string;
}

export interface FinancialStatement {
    id: number;
    analysis_run_id: number;
    year: number;
    currency: string | null;
    line_items: FinancialLineItem[];
    metrics: Record<string, number>;
    metrics_detail: Array<{
        id: number;
        statement_id: number;
        metric_name: string;
        metric_value: number;
        is_calculated: number;
        data_source: string;
    }>;
    edit_history: FinancialEdit[];
}

export interface AnalysisData {
    company_id?: number;
    company_name: string;
    currency: string;
    run_id?: number;
    company_overview: CompanyOverview;
    financial_data: FinancialDataYear[];
    financial_statements?: FinancialStatement[];
    anomalies_and_risks: AnomalyRisk[];
    quality_of_it?: QualityOfIT;
    macroeconomic_geo_view?: GeoViewCountry[];
    competitive_position?: CompetitivePosition;
    management_quality?: ManagementQuality[];
    data_sources?: {
        company_overview: Record<string, string>;
        financial_data: Record<string, Record<string, string>>;
    };
}

export interface AnalysisListItem {
    company_name: string;
    industry?: string;
    analyzed_at: string;
}

// ── Peer Rating Types ──

export interface PeerCompanyData {
    company_id?: number;
    company_name: string;
    pat?: number;
    total_equity?: number;
    roe?: number;
    gross_loan_portfolio?: number;
    countries_of_operation?: string[];
    products_and_services?: string;
    is_publicly_listed?: boolean;
    number_of_shareholders?: number;
    strategic_partners?: string[];
    management_summary?: string;
    it_summary?: string;
    currency?: string;
}

export interface SubScore {
    metric: string;
    value: number | string;
    score: number;
}

export interface CriterionScore {
    criterion: string;
    score: number;
    justification?: string;
    sub_scores?: SubScore[];
}

export interface PeerRatingResult {
    target_company: string;
    companies: PeerCompanyData[];
    scores: { [company_name: string]: CriterionScore[] };
    overall_scores: { [company_name: string]: number };
    summaries: { [company_name: string]: string };
    error?: string;
}

export interface PeerRatingWeights {
    [criterion: string]: number;
}

// ── Comparison Types ──

export interface ComparisonCompany {
    company_name: string;
    currency: string;
    original_currency?: string;
    year: number;
    usd_rate: number | null;
    metrics: Record<string, number>;
}

export interface CurrencyRate {
    id: number;
    currency: string;
    year: number;
    rate_to_usd: number;
    updated_by: number | null;
    updated_at: string;
}

export interface ComparisonData {
    companies: ComparisonCompany[];
    currency_rates: CurrencyRate[];
}
