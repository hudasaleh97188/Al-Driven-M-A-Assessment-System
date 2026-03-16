# DealLens: AI-Driven M&A Assessment System — Executive Presentation

## Slide 1: Title Slide
**DealLens — AI-Driven M&A Assessment System**

Subtitle: Automating Due Diligence for Smarter Acquisition Decisions

Tagline: From document upload to investment-grade scoring in minutes, not weeks.

Version 4.0 | March 2026

---

## Slide 2: The M&A Due Diligence Challenge Costs Firms 6–12 Weeks and $500K+ Per Target

Traditional M&A due diligence is manual, slow, and error-prone. Analysts spend weeks extracting financial data from annual reports, normalizing currencies and units, researching management teams, and benchmarking against peers — all before a single scoring decision is made.

Key pain points:
- Manual data extraction from PDF annual reports takes 2–4 weeks per target company
- Currency and unit inconsistencies across documents lead to comparison errors
- Qualitative assessments (management quality, IT infrastructure, competitive position) are subjective and inconsistent across analysts
- Peer benchmarking requires assembling data from multiple sources with no standardized framework
- No audit trail for how scores were derived, making it difficult to defend investment committee decisions

---

## Slide 3: DealLens Transforms a 6-Week Process Into a 15-Minute Automated Pipeline

DealLens is an AI-powered platform that automates the entire M&A target assessment workflow — from document ingestion to investment-grade scoring. The system accepts annual reports in PDF, PPTX, CSV, and Excel formats, extracts structured financial and operational data using Google Gemini AI, enriches it with real-time web research, and produces a standardized 9-criteria M&A attractiveness score.

Core capabilities:
- Multi-format document ingestion: PDF, PPTX, CSV, and Excel files processed natively without manual conversion
- 3-stage AI extraction pipeline using Google Gemini with structured output and web grounding
- Automated unit normalization: all financial values converted to true base currency units
- 9-criteria M&A scoring framework combining deterministic financial thresholds with qualitative AI assessment
- Real-time peer benchmarking with automatic currency conversion to USD
- Full audit trail with data source tracking ("Files Upload" vs "Web Search") on every metric

---

## Slide 4: Three-Stage AI Pipeline Extracts, Enriches, and Analyzes in Sequence

The extraction pipeline runs three sequential AI stages, each using a specialized Gemini model optimized for its task. Stage 1 extracts structured data from uploaded documents. Stage 2 fills gaps using live web search. Stage 3 conducts deep macroeconomic and competitive analysis.

Stage 1 — Document Extraction (Gemini 3.1 Pro):
- Reads all uploaded files (PDF, PPTX, CSV, Excel) with slide-by-slide and sheet-by-sheet understanding
- Extracts 18 raw financial metrics per year: Total Assets, Total Equity, PAT, Gross Loan Portfolio, Net Interest Income, Operating Expenses, NPL, Provisions, and more
- Identifies company profile: name, incorporation year, management team, shareholder structure, operational scale
- Performs 7-dimension risk assessment with data-backed findings
- Normalizes all values to true base currency units (e.g., "24,690 in thousands" becomes 24,690,000)

Stage 2 — Web Enrichment (Gemini 3 Flash + Google Search):
- Fills any missing financial or operational data not found in uploaded documents
- Researches IT infrastructure: core banking systems, digital adoption rates, vendor partnerships, cybersecurity posture
- Marks every enriched field with "Web Search" data source tag

Stage 3 — Deep Dive (Gemini 3 Pro + Google Search):
- Pulls live macroeconomic indicators for each country of operation (GDP growth, inflation, interest rates, unemployment, risk scores)
- Identifies direct competitors offering the same products in the same regions
- Researches management team backgrounds via LinkedIn and news sources

---

## Slide 5: The 9-Criteria Scoring Framework Combines Financial Rigor with AI Qualitative Assessment

DealLens evaluates every target company on 9 M&A attractiveness criteria organized into three tiers. Four criteria use deterministic Python-based scoring with predefined thresholds. Five criteria use a single Gemini AI call for qualitative assessment against detailed rubrics.

Tier 1 — Strategic Fit (Weight: 1.1x):
- Criterion 1: Contribution to Profitability — Deterministic scoring based on PAT (USDm) and ROE (%) thresholds. Score 5 for PAT > $20M and ROE > 20%.
- Criterion 2: Size of Transaction — Deterministic scoring based on Gross Loan Portfolio, Equity/GLP ratio, and geographic reach.
- Criterion 3: Geographic / Strategic Fit — Deterministic scoring using macroeconomic indicators (population, GDP growth, risk score, CPI).
- Criterion 4: Product / Market Strategy Fit — AI qualitative assessment. Score 5 for clear focus on lending (MSME, Retail, Corporate) and microfinance.

Tier 2 — Execution Complexity (Weight: 1.0x / 0.9x):
- Criterion 5: Ease of Execution — Deterministic scoring based on listing status and shareholder concentration.
- Criterion 6: Quality & Depth of Management — AI qualitative assessment of leadership experience and track record.
- Criterion 7: Strategic Partners — AI qualitative assessment of DFI/IFI backing (IFC, EIB, Proparco).

Tier 3 — Platform Quality (Weight: 0.9x):
- Criterion 8: Quality of IT & Data — AI qualitative assessment of core banking systems, cloud adoption, digital channels.
- Criterion 9: Competitor Positioning — AI qualitative assessment of market share and competitive standing.

The weighted overall score produces a verdict: Strong (4.0+), Conditional (3.25–3.99), Moderate (2.5–3.24), or Weak (<2.5) Acquisition Target.

---

## Slide 6: Currency Conversion and Unit Normalization Ensure Accurate Cross-Border Comparisons

A critical challenge in multi-country M&A assessment is comparing financial metrics across different currencies and reporting scales. DealLens solves this with a two-layer normalization approach.

Layer 1 — Unit Normalization at Extraction:
- The AI identifies the reporting scale in each document (thousands, millions, billions) by examining headers, footnotes, and cover pages
- All extracted values are multiplied to their true base currency units before storage
- The currency field stores only the ISO 4217 code (e.g., "AED"), never scale suffixes like "AED in millions"
- The database always contains exact base-unit values; the frontend formats them as K/M/B for display

Layer 2 — Currency Conversion Before Scoring:
- Before peer scoring, the backend converts all raw metrics to USD using rates from the currency_rates table
- Conversion is deterministic Python code, not LLM interpretation — ensuring exact, reproducible results
- The AI scoring prompt receives pre-converted USD values and is never asked to perform financial arithmetic
- Fallback logic tries adjacent years (±1, ±2) if an exact year rate is not available

This approach eliminates the two most common sources of error in cross-border financial comparison: scale misinterpretation and currency conversion mistakes.

---

## Slide 7: System Architecture Separates AI, Backend Logic, and Visualization Into Clean Layers

DealLens follows a modern four-layer architecture designed for reliability, auditability, and extensibility.

Frontend Layer (React + TypeScript + TailwindCSS):
- Interactive dashboards for Business Overview, Financial Health, and Rating & Comparison
- Client-side computation of 15 derived financial ratios (ROA, ROE, NIM, Cost-to-Income, NPL, etc.)
- Data source badges on every metric showing whether data came from uploaded files or web search
- Customizable scoring weights for the M&A assessment criteria

Backend Layer (FastAPI + Python):
- 14 REST API endpoints handling file upload, extraction, scoring, editing, and audit trails
- Request ID middleware for end-to-end traceability (every log line tagged with X-Request-ID)
- Structured Loguru logging with [DB_WRITE] tags for all database mutations

AI Engine (Google Gemini on Vertex AI):
- Three specialized models: Gemini 3.1 Pro (extraction), Gemini 3 Flash (web enrichment), Gemini 3 Pro (deep dive)
- Structured JSON output with strict response schemas — no free-text parsing needed
- Google Search grounding for real-time data enrichment

Database (SQLite, 10 normalized tables):
- Raw financial metrics and line items with data source tracking
- Currency rates table for deterministic USD conversion
- Full audit trail for every user edit (old value, new value, timestamp, user, comment)

---

## Slide 8: Three Dashboards Deliver Actionable Intelligence at Every Level of Analysis

DealLens presents analysis results through three purpose-built dashboards, each serving a different analytical need.

Business Overview Dashboard:
- Company profile with operational scale (branches, employees, customers, countries)
- Revenue breakdown by subsidiary/country with interactive bar charts
- Leadership profiles with experience and tenure details
- Shareholder structure with ownership percentages
- Strategic partners, IT infrastructure assessment, and competitive positioning
- Microfinance Geo-View table with macroeconomic indicators per country of operation
- Every data point tagged with its source (Files Upload or Web Search)

Financial Health Dashboard:
- KPI metric cards with compact number formatting (e.g., 66,667B, 140.00B) and YoY delta badges
- Common-size analysis donut charts for Assets, Liabilities, and Equity composition
- Detailed line item tables with year-over-year absolute and percentage changes
- 15 computed financial ratios across Profitability, Efficiency, Asset Quality, Capital, and Funding categories
- Full edit capability with audit trail for manual corrections

Rating & Comparison Dashboard:
- Tiered M&A Assessment Scores with bar visualization and tier weights
- Weighted Overall Score with acquisition target verdict
- Radar chart comparing target company vs peer average across all 9 criteria
- Detailed scores table with justifications for every criterion across all peers
- Profitability comparison chart (PAT bar + ROE line) across all companies
- Financial Comparison KPI tables (Balance Sheet, Profitability, Loan, Risk) with target company highlighted

---

## Slide 9: Full Audit Trail and Traceability Support Investment Committee Governance

Every action in DealLens is traceable, from the initial file upload to the final scoring decision. This is critical for investment committee governance and regulatory compliance.

Request-Level Traceability:
- Every HTTP request receives a unique X-Request-ID (auto-generated or client-provided)
- The ID propagates through all log entries for that request, including database writes
- Log format: timestamp | level | module:function:line | rid=<request_id> | message

Data Source Transparency:
- Every extracted metric and line item is tagged with its data source: "Files Upload" or "Web Search"
- Source badges are displayed on every KPI card, chart, and table in the UI
- Users can immediately see which data came from the company's own documents vs external research

Edit Audit Trail:
- Every manual edit to financial data or overview fields is recorded with old value, new value, timestamp, editor, and comment
- Audit history is accessible per financial statement and per overview section
- No data is ever deleted — edits create new records preserving the full history

Database Write Logging:
- All database mutations are logged with [DB_WRITE] tags at INFO level
- Examples: company creation, analysis run status updates, currency rate changes, metric edits
- Daily rotating log files with 30-day retention for compliance archival

---

## Slide 10: DealLens Delivers Measurable Impact Across the M&A Lifecycle

DealLens transforms the M&A due diligence process from a manual, weeks-long effort into an automated, auditable, and repeatable system.

Key outcomes:
- Time reduction: From 6–12 weeks of manual analysis to approximately 15 minutes per target company
- Consistency: Standardized 9-criteria framework ensures every target is evaluated on the same basis
- Accuracy: Deterministic currency conversion and unit normalization eliminate the two most common sources of comparison error
- Transparency: Full data source tracking and edit audit trails support investment committee governance
- Scalability: Analyze and compare unlimited target companies with automatic peer benchmarking
- Extensibility: Modular architecture supports adding new file formats, scoring criteria, or AI models without architectural changes

Current deployment supports the Fintech, NBFC, and Banking sectors with plans to extend to Insurance, Asset Management, and Private Equity target assessment.

Next steps:
- Production deployment with PostgreSQL database and cloud hosting
- Role-based access control (viewer, reviewer, admin) activation
- Integration with deal management platforms and data rooms
- Additional file format support (Word documents, scanned PDFs with OCR)

---
