# DealLens Backend Enhancement Plan

## 1. File Ingestion (PPTX, CSV, Excel)
- **Current State**: Only PDF is supported. Other formats are converted to PDF using `win32com` (which is Windows-only and fails on Linux/Docker).
- **Proposed Changes**:
  - Remove `win32com` dependency and `office_to_pdf.py`.
  - Update `main.py` and `extractor.py` to handle multiple file types natively.
  - **PDF**: Unchanged.
  - **PPTX**: Pass directly to Gemini as `application/vnd.openxmlformats-officedocument.presentationml.presentation`.
  - **CSV**: Pass directly to Gemini as `text/csv`.
  - **Excel (XLSX)**: Pre-process in Python using `openpyxl`. Extract each sheet as structured text preserving headers and row relationships, then pass as `text/plain`.

## 2. Unit Normalization
- **Current State**: LLM extracts raw numbers, which might be in thousands, millions, or billions, leading to inconsistent data in the DB.
- **Proposed Changes**:
  - Update `STAGE1_SYSTEM_PROMPT` in `prompts.py` to instruct the LLM to extract the value and the unit as currency instead of scale ("thousands", "millions", "billions").
  - The LLM should understand the scale and apply the conversion by multiplying or dividing, applied to all financial metrics from that document.
  - The LLM multiplies to get true base numbers before writing to DB.
  - Frontend will format as K/M/B for display.

## 3. Currency Conversion
- **Current State**: Currency conversion is handled inside the LLM prompt for peer scoring (`peer_rating_prompts.py`).
- **Proposed Changes**:
  - Remove currency conversion instructions entirely from the LLM responsible for peer scoring.
  - Before peer scoring, the backend multiplies raw metric values by `currency_rates.rate_to_usd` for the company's currency and year.
  - The scorer receives already-converted USD numbers.
  - The currency and year columns already exist on `financial_statements` — no schema change needed.

## 4. Ratio Computation Migration to Frontend
- **Current State**: Ratios are computed in the backend (`ratios.py`) and stored in the DB or computed on the fly.
- **Proposed Changes**:
  - Delete `compute_ratios()` and `compute_ratios_from_metrics()` from the backend (`ratios.py`).
  - DB stores only raw extracted metrics.
  - Create a single `computeRatios(metrics, prevMetrics?)` TypeScript function in the frontend.
  - Use this function in both `FinancialHealth.tsx` and `RatingComparison.tsx`.

## 5. Peer Rating Cleanup
- **Current State**: Criteria 4, 6, 7, 8, 9 use a single LLM prompt that includes financial numbers (PAT, equity, GLP) and currency conversion instructions.
- **Proposed Changes**:
  - Criteria 1, 2, 3, 5 stay deterministic as-is.
  - Criteria 4, 6, 7, 8, 9 stay as a single LLM prompt, but the prompt is cleaned up to only ask qualitative questions.
  - Remove PAT, equity, GLP, and any currency conversion instructions from that prompt entirely.
  - Those numbers come from the DB via the currency table before the prompt is built, and are passed to the deterministic scorers directly in Python, not mentioned in the LLM prompt at all.

## 6. Code Readability and Structure
- **Current State**: The backend code readability is not great.
- **Proposed Changes**:
  - Refactor large functions into smaller, more manageable pieces.
  - Add type hints and docstrings where missing.
  - Organize imports and follow PEP 8 guidelines.
  - Remove unused code and dead imports.

## 7. Structured Logging with Loguru
- **Current State**: Loguru is used, but logs might not be clear or traceable.
- **Proposed Changes**:
  - Clear existing logs.
  - Enhance `logging_config.py` to include a unique ID (e.g., `run_id` or `request_id`) for traceability.
  - Ensure clear logs are saved, including when there is an update to the database.
  - Use context variables in Loguru to inject the ID into all log messages for a specific request/request run.
