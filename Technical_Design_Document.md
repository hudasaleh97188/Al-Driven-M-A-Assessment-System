# DealLens Technical Design Document

**Author:** Manus AI
**Date:** March 15, 2026
**Version:** 4.0.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Module Inventory](#3-module-inventory)
4. [Data Flow and Ingestion Pipeline](#4-data-flow-and-ingestion-pipeline)
5. [Unit Normalization](#5-unit-normalization)
6. [Database Schema](#6-database-schema)
7. [API Endpoints](#7-api-endpoints)
8. [Peer Rating Engine](#8-peer-rating-engine)
9. [Frontend Integration](#9-frontend-integration)
10. [Logging and Traceability](#10-logging-and-traceability)
11. [Sequence Diagrams](#11-sequence-diagrams)
12. [Configuration](#12-configuration)
13. [Change Log (v3 to v4)](#13-change-log-v3-to-v4)

---

## 1. Executive Summary

DealLens is an AI-driven M&A assessment system designed to automate the extraction, analysis, and peer scoring of financial and operational data for target acquisitions in the Fintech, NBFC, and Banking sectors. The system leverages Google Gemini on Vertex AI to ingest complex financial documents (PDF, PPTX, CSV, Excel) and enrich the extracted data with real-time web search grounding.

This document outlines the architecture, data flows, and key design decisions implemented in version 4.0.0, which introduces native multi-format file ingestion, strict unit normalization, backend currency conversion, client-side ratio computation, and structured logging with full request traceability.

---

## 2. System Architecture

### 2.1 High-Level Overview

The DealLens system follows a modern client-server architecture with four principal layers:

| Layer | Technology | Responsibility |
|-------|-----------|---------------|
| **Frontend** | React 18 + Vite + TypeScript + TailwindCSS | Data visualization, user interactions, client-side ratio computation |
| **Backend** | FastAPI (Python 3.11) + Uvicorn | File ingestion, LLM orchestration, data normalization, peer scoring, REST API |
| **Database** | SQLite (normalized schema) | Persistent storage of raw extracted metrics, user edits, currency rates, peer ratings |
| **AI Engine** | Google Gemini on Vertex AI | Structured data extraction (Stages 1-3), qualitative peer scoring |

### 2.2 Key Design Principles

1. **Raw Data Persistence.** The database stores only raw extracted metrics (e.g., Total Assets, PAT, Net Interests). All derived financial ratios (e.g., ROA, ROE, NIM) are computed dynamically on the frontend. This eliminates the need for database migrations when ratio formulas change and ensures a single source of truth.

2. **Unit Normalization at Extraction.** The Stage 1 LLM prompt instructs Gemini to identify the scale used in each document (thousands, millions, billions) and multiply all values to their true base currency units before writing to the JSON output. The `currency` field contains only the ISO 4217 code (e.g., `"AED"`, not `"AED in millions"`).

3. **Backend Currency Conversion.** Before peer scoring, the backend multiplies raw metric values by `currency_rates.rate_to_usd` for the company's currency and year. The LLM peer scoring prompt receives already-converted USD numbers and is never asked to perform financial arithmetic.

4. **Traceability.** Every HTTP request is tagged with a unique `X-Request-ID` (auto-generated or passed by the client). This ID is propagated through all log entries via Python's `contextvars`, including database write operations tagged with `[DB_WRITE]`.

5. **Separation of Concerns.** LLM prompts are stored in dedicated modules (`prompts.py`, `peer_rating_prompts.py`) separate from the orchestration logic. Scoring rubrics, schemas, and business logic each have their own files.

---

## 3. Module Inventory

### 3.1 Backend Modules

| Module | File | Responsibility |
|--------|------|---------------|
| **Entry Point** | `main.py` | FastAPI app, CORS, middleware, all REST endpoints |
| **Config** | `app/config.py` | Centralized settings (paths, GCP project, model names, supported extensions) |
| **Logging** | `app/logging_config.py` | Loguru setup with console + daily file sinks, request ID context |
| **Database** | `app/database.py` | SQLite DDL, CRUD operations, normalized financial data persistence, seed data |
| **Extractor** | `app/extractor.py` | Three-stage agentic extraction pipeline (Gemini calls + merge logic) |
| **Prompts** | `app/prompts.py` | System/user prompt templates for Stages 1, 2, 3 |
| **Schemas** | `app/schemas.py` | Gemini response schemas (JSON Schema dicts) for Stages 1, 2, 3 |
| **File Ingest** | `app/converters/file_ingest.py` | Multi-format file ingestion (PDF, PPTX, CSV, Excel) |
| **Peer Rating** | `app/peer_rating.py` | Orchestrator: data extraction, currency conversion, scoring, summary |
| **Peer Scorer** | `app/peer_rating_scorer.py` | Deterministic + LLM scoring engine for 9 M&A criteria |
| **Peer Prompts** | `app/peer_rating_prompts.py` | Qualitative rubrics and prompt builder for LLM criteria |
| **Peer Schemas** | `app/peer_rating_schemas.py` | Gemini response schema for LLM scoring output |
| **Ratios (deprecated)** | `app/ratios.py` | Retained as empty/legacy; all ratio logic moved to frontend |

### 3.2 Frontend Key Files

| File | Responsibility |
|------|---------------|
| `src/utils/computeRatios.ts` | Single source of truth for all derived financial ratios |
| `src/pages/FinancialHealth.tsx` | Financial health dashboard with KPI cards, donut charts, line item tables |
| `src/pages/RatingComparison.tsx` | Peer rating scores and financial comparison KPI tables |
| `src/pages/BusinessOverview.tsx` | Company overview with SourceBadge components |
| `src/components/UploadForm.tsx` | File upload form (accepts PDF, PPTX, CSV, XLSX) |
| `src/components/MetricCard.tsx` | Reusable KPI metric card with optional badge slot |
| `src/api.ts` | Axios-based API client for all backend endpoints |
| `src/types.ts` | TypeScript type definitions for all data structures |

---

## 4. Data Flow and Ingestion Pipeline

### 4.1 File Ingestion (`file_ingest.py`)

The system supports native ingestion of multiple file formats without relying on external PDF conversion tools (such as `win32com` or LibreOffice). Each format is handled according to its native capabilities with the Gemini API:

| Format | MIME Type | Handling Strategy |
|--------|-----------|-------------------|
| PDF | `application/pdf` | Raw bytes passed directly to Gemini |
| PPTX | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | Raw bytes passed directly to Gemini (slide-by-slide understanding) |
| CSV | `text/csv` | Raw bytes passed directly to Gemini |
| XLSX/XLS | `text/plain` (after conversion) | Pre-processed with `openpyxl`: each sheet extracted as structured text preserving headers and row relationships |

The `ingest_file()` function returns a `ContentPart` dataclass containing the binary data, MIME type, and source filename. The `ingest_files()` wrapper processes multiple files, gracefully skipping any that fail.

### 4.2 Stage 1: Document Extraction

The ingested `ContentPart` objects are assembled into a Gemini request alongside the `STAGE1_SYSTEM_PROMPT`. The model (`gemini-3.1-pro-preview`) is configured with `thinking_level=HIGH`, `temperature=0`, and a strict `response_schema` to ensure deterministic, structured output.

The prompt instructs the LLM to:
- Identify the company name and years of data
- Extract all financial metrics in true base currency units (see Section 5)
- Conduct a 7-dimension risk assessment with data-backed findings
- Output the ISO currency code only

### 4.3 Stage 2: Web Enrichment and IT Quality

The pipeline uses `gemini-3-flash-preview` with Google Search grounding to fill any missing data fields from Stage 1. It also researches the company's technology stack, digital adoption rates, and vendor partnerships. The merge logic uses semantic equality checks to avoid overwriting Stage 1 data with inferior web-sourced values.

### 4.4 Stage 3: Macro and Management Deep Dive

The final stage uses `gemini-3-pro-preview` with Google Search grounding to pull macroeconomic indicators for each country of operation, assess competitive positioning, and research the management team's background. Results are merged into the master data dict.

### 4.5 Data Source Tracking

Throughout the merge process, the pipeline maintains a `data_sources` dictionary that tracks whether each field was sourced from "Files Upload" or "Web Search". This metadata is persisted in the `data_source` column of `financial_metrics` and `financial_line_items` tables, and displayed as SourceBadge components in the frontend.

---

## 5. Unit Normalization

### 5.1 Problem Statement

Financial documents present values in varying scales. A report might state "Revenue: 24,690" with a footnote reading "All figures in thousands of AED". Without normalization, the system would store 24,690 instead of the true value of 24,690,000.

### 5.2 Solution

The Stage 1 system prompt contains an explicit `CRITICAL: UNIT NORMALIZATION` section that instructs the LLM to:

1. **Identify the scale** used in each document, table, or section by examining headers, footnotes, and cover pages.
2. **Multiply all extracted values** to their true base currency units.
3. **Output only the ISO currency code** in the `currency` field (e.g., `"AED"`, not `"AED in thousands"`).

### 5.3 Frontend Display

The frontend uses the `formatCompact()` utility function in `computeRatios.ts` to render large base-unit numbers in human-readable form:

| Raw Value | Display |
|-----------|---------|
| 24,690,000 | 24.69M |
| 1,500,000,000 | 1.50B |
| 850,000 | 850.00K |

---

## 6. Database Schema

### 6.1 Entity-Relationship Overview

The database consists of 10 tables organized around the core entities of companies, analysis runs, and financial data.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `users` | RBAC user accounts | `username`, `password_hash`, `role` (viewer/reviewer/admin) |
| `companies` | Master record per company | `name` (unique, case-insensitive), `industry` |
| `analysis_runs` | One row per analysis execution | `company_id` (FK), `status`, `currency`, `result_json` |
| `financial_statements` | Parent record per year per run | `analysis_run_id` (FK), `year`, `currency` |
| `financial_line_items` | Detailed line items (Asset, Liability, Equity, Income) | `statement_id` (FK), `category`, `item_name`, `value_reported`, `size_percent`, `data_source` |
| `financial_metrics` | Raw extracted KPI metrics | `statement_id` (FK), `metric_name`, `metric_value`, `data_source` |
| `financial_edits` | Audit trail for user edits | `statement_id` (FK), `old_value`, `new_value`, `comment`, `edited_by` |
| `overview_edits` | Field-level overrides for overview JSON | `analysis_run_id` (FK), `field_path`, `old_value`, `new_value`, `comment` |
| `currency_rates` | USD conversion rates per currency per year | `currency`, `year`, `rate_to_usd` (unique on currency+year) |
| `peer_ratings` | Peer comparison scoring results | `company_id` (FK), `peer_company_name`, `result_json` |

### 6.2 Raw Metric Fields

The following metrics are stored in `financial_metrics` as raw extracted values. No computed ratios are persisted:

| Metric Name | Description |
|-------------|-------------|
| `total_assets` | Total assets in base currency |
| `total_liabilities` | Total liabilities in base currency |
| `total_equity` | Total equity in base currency |
| `total_operating_revenue` | Total operating revenue in base currency |
| `total_operating_expenses` | Total operating expenses in base currency |
| `pat` | Profit After Tax (Net Income) in base currency |
| `net_interests` | Net interest income in base currency |
| `ebitda` | Earnings Before Interest, Taxes, Depreciation & Amortization |
| `gross_loan_portfolio` | Gross outstanding loans + accrued interest |
| `gross_non_performing_loans` | Loans >90 days past due |
| `total_loan_loss_provisions` | Total loan loss provisions |
| `disbursals` | Loans disbursed during the year |
| `debts_to_clients` | Customer deposits |
| `debts_to_financial_institutions` | Borrowings from financial institutions |
| `tier_1_capital` | Tier 1 regulatory capital |
| `risk_weighted_assets` | Risk-weighted assets |
| `loans_with_arrears_over_30_days` | Loans with arrears >30 days |
| `credit_rating` | Group-level issuer credit rating (stored as text) |

---

## 7. API Endpoints

All endpoints are prefixed with `/api`.

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/api/health` | Health check | `{"status": "ok", "version": "4.0.0"}` |
| `GET` | `/api/analyses` | List all analyses | Array of `{company_name, company_id, run_id, status, run_at, currency}` |
| `GET` | `/api/analysis/{name}` | Full analysis for a company | Company overview, financial statements (raw metrics + line items), risks, IT quality |
| `POST` | `/api/upload` | Upload files and trigger extraction pipeline | `{company_name, run_id, status}` |
| `GET` | `/api/financial/statement/{id}` | Single financial statement detail | Statement with raw metrics, line items, and `metrics_detail` |
| `GET` | `/api/comparison` | All companies for peer comparison | Array with raw metrics per company (no computed ratios) |
| `GET` | `/api/currency-rates` | List all currency rates | Array of `{id, currency, year, rate_to_usd}` |
| `POST` | `/api/currency-rate` | Add or update a currency rate | `{id, currency, year, rate_to_usd}` |
| `POST` | `/api/peer-rating` | Trigger peer rating for a company | Full scoring result with 9 criteria |
| `POST` | `/api/financial/edit` | Edit a financial metric or line item | Updated record |
| `POST` | `/api/overview/edit` | Edit an overview field | Updated record |
| `GET` | `/api/financial/edits/{id}` | Audit trail for a statement | Array of edit records |
| `GET` | `/api/overview/edits/{id}` | Audit trail for overview edits | Array of edit records |

### 7.1 Request ID Header

Every response includes an `X-Request-ID` header. Clients may pass their own `X-Request-ID` in the request; otherwise, the middleware auto-generates a 12-character hex ID. This ID appears in all server-side log entries for that request.

---

## 8. Peer Rating Engine

### 8.1 Architecture

The peer rating pipeline is orchestrated by `peer_rating.py` and follows a strict sequence:

1. **Extract** target and peer company data from existing analyses.
2. **Convert** financial metrics (PAT, Equity, GLP) to USD millions using `currency_rates.rate_to_usd`.
3. **Score** all 9 criteria (4 deterministic + 5 LLM qualitative).
4. **Summarize** results and return structured output.

### 8.2 Currency Conversion Logic

The `_convert_to_usd()` function in `peer_rating.py` handles conversion:

- If the currency is already USD, values are simply divided by 1,000,000 to get USDm.
- Otherwise, it queries `get_currency_rate(currency, year)` from the database.
- If no exact year match exists, it tries adjacent years (±1, ±2) as a fallback.
- If no rate is found at all, values are still divided by 1,000,000 with a warning logged.

### 8.3 Scoring Criteria Summary

| # | Criterion | Method | Input Data |
|---|-----------|--------|------------|
| 1 | Contribution to Profitability | Deterministic | PAT (USDm), ROE (%) |
| 2 | Size of Transaction | Deterministic | GLP (USDm), Equity (USDm), country count |
| 3 | Geographic / Strategic Fit | Deterministic | Macro indicators (population, GDP growth, risk, CPI) |
| 4 | Product / Market Strategy Fit | LLM (qualitative) | Products/services, countries of operation |
| 5 | Ease of Execution | Deterministic | Listing status, shareholder concentration |
| 6 | Quality & Depth of Management | LLM (qualitative) | Management team profiles |
| 7 | Strategic Partners | LLM (qualitative) | DFI/IFI partnerships |
| 8 | Quality of IT & Data | LLM (qualitative) | Core systems, digital adoption, upgrades |
| 9 | Competitor Positioning | LLM (qualitative) | Market share data, industry studies |

### 8.4 LLM Prompt Design

The qualitative scoring prompt (`peer_rating_prompts.py`) is designed with explicit guardrails:

> **IMPORTANT:** Do NOT attempt any financial calculations, currency conversions, or numerical comparisons. Focus exclusively on qualitative assessment based on the rubric descriptions.

The prompt receives a slimmed-down JSON payload containing only the fields referenced by each rubric. No financial numbers (PAT, equity, GLP) are included in the LLM input.

---

## 9. Frontend Integration

### 9.1 Client-Side Ratio Computation

The `computeRatios()` function in `frontend/src/utils/computeRatios.ts` is the single source of truth for all derived financial ratios. Both `FinancialHealth.tsx` and `RatingComparison.tsx` call this function.

| Ratio | Formula | Category |
|-------|---------|----------|
| Profit Margin % | PAT / Total Operating Revenue × 100 | Profitability |
| ROE % | PAT / Avg Total Equity × 100 | Profitability |
| ROA % | PAT / Avg Total Assets × 100 | Profitability |
| Cost-to-Income % | Total Operating Expenses / Total Operating Revenue × 100 | Efficiency |
| NIM % | Net Interests / Gross Loan Portfolio × 100 | Profitability |
| PAR 30 % | Loans with Arrears >30d / Gross Loan Portfolio × 100 | Asset Quality |
| NPL % | Gross NPL / Gross Loan Portfolio × 100 | Asset Quality |
| Provision Coverage % | Total Provisions / Gross NPL × 100 | Asset Quality |
| Equity-to-GLP % | Total Equity / Gross Loan Portfolio × 100 | Capital |
| Capital Adequacy % | Total Equity / Total Assets × 100 | Capital |
| Deposits-to-Assets % | Debts to Clients / Total Assets × 100 | Funding |
| Loan-to-Deposit % | Gross Loan Portfolio / Debts to Clients × 100 | Funding |
| Loans-to-Assets % | Gross Loan Portfolio / Total Assets × 100 | Funding |
| Depositors vs Borrowers | Debts to Clients / Debts to FIs | Funding |
| Interest Coverage | Net Interests / abs(Total Operating Expenses) | Risk |

Where applicable, average-based denominators use the mean of the current and previous year's values (e.g., average total equity for ROE).

### 9.2 Data Source Badges

Every KPI metric card, donut chart, and line item table in the Financial Health page displays a **SourceBadge** indicating whether the underlying data came from "Files Upload" (blue badge) or "Web Search" (green badge). The source is dynamically looked up from `metrics_detail[].data_source` for raw metrics and `line_items[].data_source` for line items. For computed ratios, the source is derived from the input metrics.

### 9.3 Display Formatting

The `formatCompact()` utility formats large base-unit numbers with K/M/B suffixes for display. The frontend never stores formatted values; formatting is always applied at render time.

---

## 10. Logging and Traceability

### 10.1 Loguru Configuration

The backend uses `loguru` with two sinks configured in `logging_config.py`:

| Sink | Level | Format | Rotation |
|------|-------|--------|----------|
| Console (stdout) | INFO | Colorized with timestamp, level, module:function:line, rid, message | N/A |
| File (`logs/deallens_YYYY-MM-DD.log`) | DEBUG | Plain text with same structure | Daily at midnight, 30-day retention |

### 10.2 Log Line Format

Every log line follows this structure:

```
2026-03-15 14:32:01.123 | INFO     | app.database:upsert_company:195 | rid=a1b2c3d4e5f6 | [DB_WRITE] upsert_company name='Emirates NBD' → id=1
```

The fields are: `timestamp | level | module:function:line | rid=<request_id> | message`.

### 10.3 Request ID Propagation

The `request_id_middleware` in `main.py` performs the following on every request:

1. Reads `X-Request-ID` from the incoming request headers (or generates a 12-char hex UUID).
2. Calls `bind_request_id(rid)` to set the context variable for the current async context.
3. Logs the request method, path, and assigned `rid`.
4. Attaches `X-Request-ID` to the response headers.

### 10.4 Database Write Logging

All functions that modify the database include a `[DB_WRITE]` tag in their log message at the `INFO` level. This enables quick filtering of state-changing operations:

```
[DB_WRITE] upsert_company name='Emirates NBD' → id=1
[DB_WRITE] create_run company_id=1 → run_id=4
[DB_WRITE] update_run run_id=4 → status=completed
[DB_WRITE] upsert_currency_rate currency=AED year=2024 rate=0.2723
```

---

## 11. Sequence Diagrams

### 11.1 File Upload and Extraction

```
User → Frontend: Upload files (PDF, PPTX, CSV, XLSX)
Frontend → Backend: POST /api/upload (multipart/form-data)
Backend → file_ingest: ingest_files(file_paths)
file_ingest → Backend: List[ContentPart]
Backend → database: upsert_company(), create_run()
Backend → extractor: run_pipeline(file_paths)
  extractor → Gemini: Stage 1 (document extraction)
  Gemini → extractor: Structured JSON (base-unit values)
  extractor → Gemini: Stage 2 (web enrichment)
  Gemini → extractor: Enriched JSON
  extractor → Gemini: Stage 3 (macro + management)
  Gemini → extractor: Deep-dive JSON
  extractor → extractor: Merge all stages
extractor → Backend: Final merged dict
Backend → database: update_run(result, status="completed")
  database: Save normalized financial data (metrics + line items)
Backend → Frontend: {company_name, run_id, status}
```

### 11.2 Peer Rating

```
User → Frontend: Trigger peer rating
Frontend → Backend: POST /api/peer-rating {company_name, peer_names}
Backend → database: Load target + peer analyses
Backend → peer_rating: run_peer_rating(target, peers)
  peer_rating: Extract company data
  peer_rating → database: get_currency_rate(currency, year)
  peer_rating: Convert PAT, Equity, GLP → USD millions
  peer_rating → peer_rating_scorer: compute_all_scores(companies)
    scorer: Criteria 1,2,3,5 → deterministic (Python)
    scorer → Gemini: Criteria 4,6,7,8,9 → single LLM call (qualitative only)
    Gemini → scorer: JSON scores + justifications
  scorer → peer_rating: All 9 criteria scores
  peer_rating: Generate summaries
peer_rating → Backend: Structured result
Backend → Frontend: {scores, overall_scores, summaries, companies}
```

### 11.3 Financial Health Page Load

```
User → Frontend: Navigate to Financial Health
Frontend → Backend: GET /api/analysis/{name}
Backend → database: Load analysis + statements + metrics + line items
Backend → Frontend: JSON (raw metrics only, no computed_ratios)
Frontend → computeRatios: computeRatios(metrics, prevMetrics)
computeRatios → Frontend: ComputedRatios object
Frontend: Render MetricCards with SourceBadges
Frontend: Render CommonSizePie donut charts
Frontend: Render line item tables
```

---

## 12. Configuration

All configuration is centralized in `app/config.py` and can be overridden via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `GCP_PROJECT_ID` | `rag-project-485016` | Google Cloud project for Vertex AI |
| `VERTEX_LOCATION` | `global` | Vertex AI region |
| `PRIMARY_MODEL` | `gemini-3.1-pro-preview` | Model for Stage 1 extraction |
| `SERVER_HOST` | `0.0.0.0` | FastAPI bind address |
| `SERVER_PORT` | `5050` | FastAPI bind port |

Supported upload file extensions are defined as a constant: `{".pdf", ".pptx", ".csv", ".xlsx", ".xls"}`.

---

## 13. Change Log (v3 to v4)

This section documents all changes made from the previous version to v4.0.0.

### 13.1 File Ingestion

| Before (v3) | After (v4) |
|-------------|------------|
| Only PDF supported; PPTX/XLSX converted to PDF via `win32com` (Windows-only) | Native multi-format: PDF, PPTX, CSV passed directly to Gemini; Excel pre-processed with `openpyxl` |
| `converters/office_to_pdf.py` (Windows dependency) | `converters/file_ingest.py` (cross-platform) |
| Single MIME type (`application/pdf`) | Format-specific MIME types for optimal Gemini understanding |

### 13.2 Unit Normalization

| Before (v3) | After (v4) |
|-------------|------------|
| LLM extracted values as-is from documents (e.g., "24,690" when report says "in thousands") | LLM multiplies to true base units (e.g., 24,690,000) |
| Currency field could contain scale suffixes (e.g., "AED in millions") | Currency field contains only ISO code (e.g., "AED") |
| Frontend had to guess the scale | Frontend always receives base-unit values; formats with K/M/B for display |

### 13.3 Currency Conversion

| Before (v3) | After (v4) |
|-------------|------------|
| Currency conversion instructions embedded in LLM peer scoring prompt | Currency conversion done deterministically in Python (`peer_rating._convert_to_usd()`) |
| LLM asked to interpret currency codes and apply rates | LLM receives pre-converted USD values; no financial arithmetic in prompt |
| Conversion accuracy depended on LLM interpretation | Conversion uses exact rates from `currency_rates` table |

### 13.4 Ratio Computation

| Before (v3) | After (v4) |
|-------------|------------|
| `compute_ratios()` and `compute_ratios_from_metrics()` in `ratios.py` | Both functions deleted from backend |
| `computed_ratios` dict stored in DB and sent via API | DB stores only raw metrics; API response has no `computed_ratios` |
| Ratio definitions duplicated between backend and frontend | Single `computeRatios()` TypeScript function used by both `FinancialHealth.tsx` and `RatingComparison.tsx` |

### 13.5 Peer Rating Prompts

| Before (v3) | After (v4) |
|-------------|------------|
| LLM prompt included PAT, equity, GLP values and currency conversion instructions | LLM prompt contains only qualitative fields; all financial numbers removed |
| Mixed deterministic + LLM scoring in prompt | Clean separation: deterministic criteria in Python, qualitative criteria in single LLM call |
| Financial conversion fields in LLM response schema | Schema reduced to criterion name, score, and justification only |

### 13.6 Backend Code Quality

| Before (v3) | After (v4) |
|-------------|------------|
| Mixed logging with `print()` and basic `logging` | Structured `loguru` with request ID traceability and `[DB_WRITE]` tags |
| No request ID tracking | `X-Request-ID` middleware on every request |
| Large monolithic functions | Refactored into focused, well-documented functions with type hints |
| Inconsistent error handling | Consistent `try/except` with structured error logging |

### 13.7 Frontend Updates

| Before (v3) | After (v4) |
|-------------|------------|
| Read `stmt.computed_ratios` from backend | Calls `computeRatios(stmt.metrics, prevStmt.metrics)` |
| No data source indicators on Financial Health page | SourceBadge on every MetricCard, donut chart, and line item table |
| File upload accepted only PDF | File upload accepts PDF, PPTX, CSV, XLSX |
| `computed_ratios` field in TypeScript types | Field removed from `FinancialStatement` and `ComparisonCompany` types |

---

## Appendix A: Dependencies

### Backend (`requirements.txt`)

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework |
| `uvicorn[standard]` | ASGI server |
| `python-multipart` | File upload handling |
| `google-genai` | Vertex AI Gemini client |
| `loguru` | Structured logging |
| `openpyxl` | Excel file processing |

### Frontend (`package.json`)

| Package | Purpose |
|---------|---------|
| `react` / `react-dom` | UI framework |
| `vite` | Build tool |
| `typescript` | Type safety |
| `tailwindcss` | Utility-first CSS |
| `axios` | HTTP client |
| `recharts` | Chart components |
| `react-router-dom` | Client-side routing |

---

## Appendix B: File Tree (Backend)

```
backend/
├── main.py                          # FastAPI app + endpoints + middleware
├── requirements.txt                 # Python dependencies
├── app/
│   ├── __init__.py
│   ├── config.py                    # Centralized settings
│   ├── logging_config.py            # Loguru setup + request ID
│   ├── database.py                  # SQLite DDL + CRUD + seed data
│   ├── extractor.py                 # 3-stage extraction pipeline
│   ├── prompts.py                   # LLM prompt templates (Stages 1-3)
│   ├── schemas.py                   # Gemini response schemas
│   ├── ratios.py                    # (deprecated – logic moved to frontend)
│   ├── peer_rating.py               # Peer rating orchestrator
│   ├── peer_rating_scorer.py        # Deterministic + LLM scoring engine
│   ├── peer_rating_prompts.py       # Qualitative rubrics + prompt builder
│   ├── peer_rating_schemas.py       # LLM scoring response schema
│   └── converters/
│       ├── __init__.py
│       ├── file_ingest.py           # Multi-format file ingestion
│       └── office_to_pdf.py         # (deprecated – replaced by file_ingest)
├── data/
│   └── deallens.db                  # SQLite database (auto-created)
└── logs/
    └── deallens_YYYY-MM-DD.log      # Daily rolling log files
```
