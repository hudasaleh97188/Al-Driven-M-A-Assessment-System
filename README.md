# DealLens M&A Assessment System

An AI-driven M&A financial analyzer that extracts structured key performance indicators (KPIs) and risk anomalies from unstructured annual reports using Google's Vertex AI (Gemini Pro). 

## Architecture
- **Backend**: FastAPI (Python) with SQLite for data persistence, operating out of the `/backend` folder.
- **Frontend**: React, Vite, Tailwind CSS, and Recharts, operating out of the `/frontend` folder.

## Setup & Running

**Prerequisites:** 
- Python 3.9+
- Node.js & npm

1. **Start the FastAPI Server**:
   ```bash
   cd backend
   pip install fastapi uvicorn python-multipart google-genai
   uvicorn main:app --host 0.0.0.0 --port 5050 --reload
   ```

2. **Start the React Frontend**:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   *The frontend application will be available at `http://localhost:4000`.*

## Key Features
- **Historical Dashboard**: View and instantly retrieve historical AI analyses as cards directly from the main interface.
- **Caching & Persistence**: Extracted JSON from Vertex AI is saved to `deallens.db`. Looking up a previously analyzed company loads instantaneously without triggering redundant LLM processing.
- **Actionable UI**: A visually striking dark-mode React UI, presenting diagnostic KPIs, colored deltas (strictly green for positive, red for negative), dynamic Ratio Bars, and a categorized Risk & Anomalies list.
