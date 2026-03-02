# DealLens – AI-Driven M&A Assessment System (Backend)

An AI-powered due diligence pipeline that extracts, enriches, and analyses financial data from annual reports using Google Gemini on Vertex AI.

## Architecture

```
backend/
├── app/
│   ├── __init__.py            # Package init
│   ├── config.py              # Centralised settings (GCP, paths, server)
│   ├── logging_config.py      # Loguru: console + daily rolling file
│   ├── database.py            # 2-table SQLite (companies + analysis_runs)
│   ├── schemas.py             # Gemini structured output schemas (Stages 1–3)
│   ├── prompts.py             # LLM prompt templates
│   ├── ratios.py              # Derived financial ratio computations
│   └── extractor.py           # 3-stage LLM pipeline with full loguru logging
├── main.py                    # FastAPI entry point
├── data/                      # SQLite DB (auto-created)
└── logs/                      # Daily log files (auto-created)
```

### Database Design (2 tables)

| Table | Purpose |
|---|---|
| `companies` | `id`, `name` (unique, case-insensitive), `created_at`, `updated_at` |
| `analysis_runs` | `id`, `company_id` (FK), `run_at`, `status`, `currency`, `result_json`, `error_message` |

The full LLM output is stored as a single JSON document — no 17-table normalization needed.

### 3-Stage Extraction Pipeline

| Stage | Input | Output | Search? |
|---|---|---|---|
| **Stage 1** – PDF Extraction | Annual report PDFs | Financial data, overview, risks | No |
| **Stage 2** – Web Enrichment | Stage 1 output | Patched gaps + IT quality | Google Search |
| **Stage 3** – Deep Dive | Stage 1+2 output | Macro, competitive, management | Google Search |

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server
cd backend
python main.py
# → Listening on http://0.0.0.0:5050
# → Swagger docs at http://localhost:5050/docs
```

### Environment Variables (optional)

| Variable | Default | Description |
|---|---|---|
| `GCP_PROJECT_ID` | `rag-project-485016` | Google Cloud project |
| `VERTEX_LOCATION` | `global` | Vertex AI location |
| `PRIMARY_MODEL` | `gemini-3.1-pro-preview` | Gemini model ID |
| `SERVER_HOST` | `0.0.0.0` | Server bind address |
| `SERVER_PORT` | `5050` | Server port |

## API Reference

### `POST /api/analyze`

Upload PDFs and run the 3-stage pipeline.

**Form fields:**
- `company_name` (string, required) – Name of the company
- `files` (files, required) – One or more PDF annual reports
- `force` (boolean, optional, default: `false`) – Force re-analysis even if cached

**Response:** Full analysis JSON (see [Sample Output](#sample-output))

---

### `GET /api/analysis/{company_name}`

Get the latest completed analysis for a company.

**Response:** Full analysis JSON or `404`

---

### `GET /api/analyses`

List all companies with their latest analysis timestamp.

**Response:**
```json
[
  { "company_name": "Baobab Group", "analyzed_at": "2026-03-01 22:30:00" },
  { "company_name": "Konfio", "analyzed_at": "2026-02-28 14:15:00" }
]
```

---

### `DELETE /api/analysis/{company_name}`

Delete a company and all its analysis runs.

**Response:** `{ "message": "Analysis for 'Baobab Group' deleted successfully" }`

## Logging

Every LLM call logs:
- `[LLM_REQUEST]` – stage, model, config, full prompt
- `[LLM_RESPONSE]` – full JSON output
- `[LLM_ERROR]` – failures with full stack trace

Logs are written to both **stdout** and **`logs/deallens_YYYY-MM-DD.log`** (30-day retention).

## Sample Output

See [`sample_output.json`](./sample_output.json) for a complete example of what `GET /api/analysis/{company_name}` returns. This is the shape the frontend should consume.
