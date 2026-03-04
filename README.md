# DealLens – AI-Driven M&A Assessment System

An AI-powered due diligence platform that extracts structured KPIs from annual reports, performs multi-stage enrichment via Google Gemini on Vertex AI, and benchmarks acquisition targets against peer competitors.

## Architecture

```
├── backend/                        # FastAPI + Python
│   ├── app/
│   │   ├── config.py               # Centralised settings (GCP, paths, server)
│   │   ├── logging_config.py       # Loguru: console + daily rolling file
│   │   ├── database.py             # SQLite (companies, analysis_runs, peer_ratings)
│   │   ├── schemas.py              # Gemini structured output schemas (Stages 1–3)
│   │   ├── prompts.py              # LLM prompt templates
│   │   ├── ratios.py               # Derived financial ratio computations
│   │   ├── extractor.py            # 3-stage LLM pipeline
│   │   ├── peer_rating_schemas.py  # Gemini schemas for peer data + scoring
│   │   ├── peer_rating_prompts.py  # Rubric-based prompts for M&A scoring
│   │   ├── peer_rating_scorer.py   # Percentile + LLM scoring engine
│   │   └── peer_rating.py          # Peer rating pipeline orchestrator
│   ├── main.py                     # FastAPI entry point
│   ├── data/                       # SQLite DB (auto-created)
│   └── logs/                       # Daily log files (auto-created)
│
├── frontend/                       # React + Vite + Tailwind + Recharts
│   └── src/
│       ├── App.tsx                  # Root app with tabs
│       ├── api.ts                   # API client
│       ├── types.ts                 # TypeScript interfaces
│       ├── pages/
│       │   ├── BusinessOverview.tsx  # Company overview, leadership, IT, macro
│       │   ├── FinancialHealth.tsx   # Financial metrics, ratios, risks
│       │   └── RatingComparison.tsx  # Peer rating & M&A attractiveness
│       └── components/
│           ├── Dashboard.tsx         # Company list & history
│           ├── UploadForm.tsx        # PDF upload form
│           ├── MetricCard.tsx        # Financial metric display
│           ├── RatioBar.tsx          # Ratio visualisation
│           └── RiskCard.tsx          # Risk/anomaly card
│
└── requirements.txt
```

## Prerequisites

- **Python 3.9+**
- **Node.js 18+** & npm
- **Google Cloud project** with Vertex AI API enabled
- **Authentication**: `gcloud auth application-default login` (or set `GOOGLE_APPLICATION_CREDENTIALS`)

## Quick Start

### 1. Backend

```bash
# Install Python dependencies
pip install -r requirements.txt

# Start the FastAPI server
cd backend
python main.py
# → API: http://localhost:5050
# → Swagger: http://localhost:5050/docs
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# → UI: http://localhost:4000
```

### 3. Environment Variables (`.env` or shell)

| Variable | Default | Description |
|---|---|---|
| `GCP_PROJECT_ID` | `rag-project-485016` | Google Cloud project |
| `VERTEX_LOCATION` | `global` | Vertex AI region |
| `PRIMARY_MODEL` | `gemini-3.1-pro-preview` | Gemini model for Stage 1 |
| `SERVER_HOST` | `0.0.0.0` | Server bind address |
| `SERVER_PORT` | `5050` | Server port |

## Key Features

### 📄 3-Stage Extraction Pipeline

| Stage | Input | Output | Search? |
|---|---|---|---|
| **Stage 1** – PDF Extraction | Annual report PDFs | Financial data, overview, risks | ❌ |
| **Stage 2** – Web Enrichment | Stage 1 output | Patched gaps + IT quality | ✅ Google Search |
| **Stage 3** – Deep Dive | Stage 1+2 output | Macro, competitive, management | ✅ Google Search |

### 🏆 Peer Rating & M&A Attractiveness

Compares the target company against extracted competitors on **8 criteria**:

| # | Criterion | Method |
|---|-----------|--------|
| 1 | Contribution to Profitability | Percentile (PAT, ROE, ROA) |
| 2 | Size of Transaction | Percentile (Gross Loans, Customers, Branches) |
| 3 | Geographic / Strategic Fit | Percentile (strategic country coverage) |
| 4 | Product / Market Strategy Fit | LLM-evaluated (rubric-based) |
| 5 | Ease of Execution | LLM-evaluated (public/private, shareholders) |
| 6 | Quality & Depth of Management | LLM-evaluated (CEO/CFO/CTO/CRO experience) |
| 7 | Strategic Partners | LLM-evaluated (IFI/DFI presence) |
| 8 | Quality of IT & Data | LLM-evaluated (digital maturity) |

All competitor financials are normalised to **USD millions**.

### 📊 UI Components

- **Business Overview** – Products, countries, leadership, shareholders, strategic partners, IT quality, competitors, macroeconomic geo-view
- **Financial Health** – Time-series metrics, computed ratios (ROE, ROA, NIM, PAR, GNPA, CAR), risks & anomalies
- **Rating & Comparison** – Composite score card, overall score with verdict, radar chart (vs peer avg), comparison table with tooltips, profitability & size charts

### 💾 Database

| Table | Purpose |
|---|---|
| `companies` | Master record per company |
| `analysis_runs` | One row per analysis (full JSON blob) |
| `peer_ratings` | One row per peer rating run (full JSON blob) |

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/analyze` | Upload PDFs → run 3-stage pipeline |
| `GET` | `/api/analysis/{company}` | Get latest completed analysis |
| `GET` | `/api/analyses` | List all companies with timestamps |
| `DELETE` | `/api/analysis/{company}` | Delete company and all runs |
| `POST` | `/api/peer-rating/{company}` | Run peer rating pipeline |
| `GET` | `/api/peer-rating/{company}` | Get cached peer rating |

## Logging

Every LLM call logs `[LLM_REQUEST]`, `[LLM_RESPONSE]`, and `[LLM_ERROR]` with full prompt/response text.
Logs go to both **stdout** and **`backend/logs/deallens_YYYY-MM-DD.log`** (30-day retention).
