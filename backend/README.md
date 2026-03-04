# DealLens – Backend

AI-powered due diligence pipeline using Google Gemini on Vertex AI.

## Architecture

```
backend/
├── app/
│   ├── config.py               # Settings (GCP, paths, server)
│   ├── logging_config.py       # Loguru: console + daily rolling file
│   ├── database.py             # SQLite (companies, analysis_runs, peer_ratings)
│   ├── schemas.py              # Gemini schemas (Stages 1–3)
│   ├── prompts.py              # LLM prompt templates
│   ├── ratios.py               # Derived financial ratio computations
│   ├── extractor.py            # 3-stage LLM extraction pipeline
│   ├── peer_rating_schemas.py  # Gemini schemas for peer data + scoring
│   ├── peer_rating_prompts.py  # Rubric-based prompts for M&A scoring
│   ├── peer_rating_scorer.py   # Percentile + LLM scoring engine
│   └── peer_rating.py          # Peer rating pipeline orchestrator
├── main.py                     # FastAPI entry point
├── data/                       # SQLite DB (auto-created)
└── logs/                       # Daily log files (auto-created)
```

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server
cd backend
python main.py
# → API: http://localhost:5050
# → Swagger: http://localhost:5050/docs
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GCP_PROJECT_ID` | `rag-project-485016` | Google Cloud project |
| `VERTEX_LOCATION` | `global` | Vertex AI location |
| `PRIMARY_MODEL` | `gemini-3.1-pro-preview` | Gemini model ID |
| `SERVER_HOST` | `0.0.0.0` | Server bind address |
| `SERVER_PORT` | `5050` | Server port |

## Database (3 tables)

| Table | Purpose |
|---|---|
| `companies` | `id`, `name` (unique, case-insensitive), `created_at`, `updated_at` |
| `analysis_runs` | `id`, `company_id` (FK), `run_at`, `status`, `currency`, `result_json`, `error_message` |
| `peer_ratings` | `id`, `company_id` (FK, unique), `run_at`, `result_json` |

## Extraction Pipeline (3 stages)

| Stage | Input | Output | Search? |
|---|---|---|---|
| **Stage 1** – PDF Extraction | Annual report PDFs | Financial data, overview, risks | ❌ |
| **Stage 2** – Web Enrichment | Stage 1 output | Patched gaps + IT quality | ✅ Google Search |
| **Stage 3** – Deep Dive | Stage 1+2 output | Macro, competitive, management | ✅ Google Search |

## Peer Rating Pipeline

Triggered via `POST /api/peer-rating/{company}`. Requires a completed analysis.

1. Extracts target company data from existing analysis
2. Collects competitor data via Gemini + Google Search (all financials in **USD**)
3. Scores all companies on **8 criteria** (3 percentile-based, 5 LLM-evaluated)
4. Computes overall score and verdict
5. Caches result in `peer_ratings` table

### Scoring Criteria

| # | Criterion | Method |
|---|-----------|--------|
| 1 | Contribution to Profitability | Percentile on PAT, ROE, ROA |
| 2 | Size of Transaction | Percentile on Gross Loans, Customers, Branches |
| 3 | Geographic / Strategic Fit | Percentile on strategic country count |
| 4 | Product / Market Strategy Fit | LLM rubric (lending, MSME, banking, microfinance, deposits) |
| 5 | Ease of Execution | LLM rubric (public/private, shareholder count) |
| 6 | Quality & Depth of Management | LLM rubric (CEO/CFO/CTO/CRO experience) |
| 7 | Strategic Partners | LLM rubric (IFI/DFI presence and caliber) |
| 8 | Quality of IT & Data | LLM rubric (core banking, digital adoption) |

**Verdict:** Strong (≥80), Conditional (65–79), Moderate (50–64), Weak (<50)

## API Reference

### Analysis Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/analyze` | Upload PDFs → run 3-stage pipeline |
| `GET` | `/api/analysis/{company_name}` | Get latest completed analysis |
| `GET` | `/api/analyses` | List all companies with timestamps |
| `DELETE` | `/api/analysis/{company_name}` | Delete company and all runs |

### Peer Rating Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/peer-rating/{company_name}` | Run peer rating pipeline |
| `GET` | `/api/peer-rating/{company_name}` | Get cached peer rating |

### `POST /api/analyze` details

**Form fields:**
- `company_name` (string, required)
- `files` (file[], required) – PDF annual reports
- `force` (boolean, optional, default: `false`) – Force re-analysis

### `POST /api/peer-rating/{company_name}` details

Requires a completed analysis for the company. Collects competitor data and scores all companies. Takes ~2–3 minutes for 5 competitors.

## Logging

Every LLM call logs `[LLM_REQUEST]`, `[LLM_RESPONSE]`, and `[LLM_ERROR]`.
Peer rating logs use `[PEER_COLLECT]` and `[PEER_SCORING]` prefixes.
Logs go to both **stdout** and **`logs/deallens_YYYY-MM-DD.log`** (30-day retention).

## Sample Output

See [`sample_output.json`](./sample_output.json) for a complete analysis response.
