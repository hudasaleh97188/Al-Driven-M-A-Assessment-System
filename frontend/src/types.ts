// TypeScript interfaces matching the backend sample_output.json shape

export interface SubsidiaryRevenue {
    subsidiary_or_country: string;
    total_operating_revenue: number;
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
    revenue_by_subsidiaries_or_country?: SubsidiaryRevenue[];
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

export interface AnalysisData {
    company_id?: number;
    company_name: string;
    currency: string;
    company_overview: CompanyOverview;
    financial_data: FinancialDataYear[];
    anomalies_and_risks: AnomalyRisk[];
    quality_of_it?: QualityOfIT;
    macroeconomic_geo_view?: GeoViewCountry[];
    competitive_position?: CompetitivePosition;
    management_quality?: ManagementQuality[];
}

export interface AnalysisListItem {
    company_name: string;
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
