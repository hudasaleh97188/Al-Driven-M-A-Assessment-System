# DealLens System Logic & Scoring Guide

This document explains the core logic behind the DealLens M&A Assessment System, detailing what each LLM step accomplishes and how the 8-point Peer Rating system calculates its scores.

---

## Part 1: The Core Extraction Pipeline (3 Stages)

When a user uploads an Annual Report (PDF), the system runs a 3-stage LLM pipeline to extract, enrich, and deeply analyze the company.

### Stage 1: PDF Extraction (No Search)
*   **Model:** `gemini-3.1-pro-preview`
*   **Input:** The raw text extracted from the uploaded PDF annual reports.
*   **Goal:** Extract structured foundational data.
*   **What it does:** Scans the document for the company's full name, year of incorporation, management team, shareholder structure, operational scale (branches, borrowers), and up to 5 years of financial performance metrics (PAT, Equity, Assets, Gross Loan Portfolio). It also identifies severe operational or financial risks stated in the report.

### Stage 2: Web Enrichment (Schema + Search)
*   **Model:** `gemini-3-flash-preview` 
*   **Input:** The JSON output from Stage 1.
*   **Goal:** Fill in gaps and assess IT infrastructure.
*   **What it does:** Uses Google Search to find any missing financial or overview data not present in the PDF. Crucially, it searches the web for the company's "Quality of IT & Data Usage," identifying their core banking systems (e.g., Temenos), digital channel adoption rates, system upgrades, vendor partnerships, and any public cybersecurity incidents.

### Stage 3: Deep Dive (Schema + Search)
*   **Model:** `gemini-3-pro-preview`
*   **Input:** The outputs of Stages 1 & 2.
*   **Goal:** Gather macroeconomic context, identify direct competitors, and evaluate management history.
*   **What it does:** Uses Google Search to pull live macroeconomic data (GDP growth, inflation, interest rates) for the countries the company operates in. It explicitly searches for **direct competitors** offering the exact same products in the same regions to prevent hallucinations. Finally, it searches LinkedIn and news for the management team to find their previous experiences and track records.

---

## Part 2: The Peer Rating System (8 Active Criteria, Scale 1–5)

Once a company is analyzed, it is automatically scored on 8 M&A attractiveness criteria using its own data. The user can then optionally select **peers** from a list of other already-analyzed companies in the system. The system will pull the existing data for those peers and compare their scores against the target company.

The system uses deterministic thresholds for quantitative criteria and a **single LLM call** for qualitative criteria.

### Scoring Methods

| # | Criterion | Method |
|---|-----------|--------|
| 1 | Contribution to Profitability | Deterministic |
| 2 | Size of Transaction | Deterministic |
| 3 | Geographic / Strategic Fit | *Commented out (pending input)* |
| 4 | Product / Market Strategy Fit | LLM (single call) |
| 5 | Ease of Execution | Deterministic |
| 6 | Quality & Depth of Management | LLM (single call) |
| 7 | Strategic Partners | LLM (single call) |
| 8 | Quality of IT & Data | LLM (single call) |
| 9 | Competitor Positioning | LLM (single call) |

### A. Deterministic Criteria

**1. Contribution to Profitability**
*   PAT (USDm): 5: >20 | 4: 10–20 | 3: 5–10 | 2: 0–5 | 1: <0
*   ROE (%): 5: >20% | 3: 10–20% | 1: <10%
*   Final score = average of PAT and ROE sub-scores.

**2. Size of Transaction**
*   Gross Loan Portfolio (USDm): 5: >500 | 4: 300–500 | 3: 100–300 | 2: 50–100 | 1: <50
*   Equity / GLP (%): 5: >25% | 4: 20–25% | 3: 15–20% | 2: <15%
*   Geographic Reach: 5: >3 countries | 4: 2–3 countries | 3: 1 country
*   Final score = average of sub-scores.

**3. Geographic / Strategic Country Fit** *(commented out — awaiting input)*

**5. Ease of Execution**
*   Listing: 5: Private | 3: Public
*   Concentration: 5: Single >80% | 4: Two >50% | 2: Three+ >50%
*   Final score = average of listing and concentration sub-scores.

### B. LLM-Evaluated Criteria (Single Call)

All 5 qualitative criteria are scored in **one LLM call** to minimize latency and token usage. Only the relevant data fields are sent for each criterion.

**4. Product / Market Strategy Fit**
*   5: Clear focus on Lending (MSME, Retail, Corporate) and Microfinance.
*   3: Deposits and payments products only.
*   1: Niche products with limited scalability or heavy reliance on unsecured retail microloans.

**6. Quality & Depth of Management**
*   5: Deep institutional experience (e.g., former Top-tier Bank/Consulting execs).
*   3: Solid domestic or regional experience.
*   2: Limited track record or thin C-suite presence.

**7. Strategic Partners**
*   5: Backed by major international DFIs (IFC, EIB, Proparco, Norfund).
*   4: Backed by reliable regional players or local government.
*   3: Local commercial banks, unknown entities, or no strategic partners.

**8. Quality of IT & Data**
*   5: Modern Core Banking Systems (Temenos, Mambu), Cloud-native, high digital adoption.
*   3: Legacy systems with recent upgrades.
*   1: Outdated legacy systems or lack of digital data.

**9. Competitor Positioning** *(uses Stage 3 competitive data, no additional search)*
*   5: Top 1–3 in at least 2 markets.
*   4: Top 1–3 in at least 1 market.
*   3: Top 4–6 in at least 2 markets.
*   1: Otherwise.

### Step 3: Weighted Overall Score (Frontend)

The system calculates the **Weighted M&A Attractiveness Score** in the frontend. Users can customize weights for each criterion (summing to 100) via the "Edit Weights" UI. By default, all criteria are equally weighted. Based on the weighted average, the UI assigns a verdict:
*   **≥ 4.0:** Strong Acquisition Target
*   **3.25 – 3.99:** Conditional Acquisition Target
*   **2.5 – 3.24:** Moderate Acquisition Target
*   **< 2.5:** Weak Acquisition Target
