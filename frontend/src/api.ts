import type { AnalysisData, AnalysisListItem, PeerRatingResult, FinancialStatement, ComparisonData } from './types';

const API_BASE = window.location.hostname === 'localhost' 
    ? 'http://localhost:5050' 
    : `https://5050-${window.location.hostname.split('-').slice(1).join('-')}`;

export async function fetchAnalyses(): Promise<AnalysisListItem[]> {
    const res = await fetch(`${API_BASE}/api/analyses`);
    if (!res.ok) throw new Error('Failed to fetch analyses');
    return res.json();
}

export async function fetchAnalysis(companyName: string): Promise<AnalysisData> {
    const res = await fetch(`${API_BASE}/api/analysis/${encodeURIComponent(companyName)}`);
    if (!res.ok) throw new Error('Company not found');
    return res.json();
}

export async function runAnalysis(companyName: string, files: File[]): Promise<AnalysisData> {
    const formData = new FormData();
    formData.append('company_name', companyName);
    files.forEach(f => formData.append('files', f));

    const res = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        body: formData,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Analysis failed' }));
        throw new Error(err.detail || 'Analysis failed');
    }
    return res.json();
}

export async function deleteAnalysis(companyName: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/analysis/${encodeURIComponent(companyName)}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete');
}

// ── Financial Edit Endpoints ──

export interface EditItem {
    line_item_id?: number | null;
    metric_name?: string | null;
    old_value: number;
    new_value: number;
    comment: string;
}

export async function bulkEditFinancials(
    statementId: number,
    edits: EditItem[],
    username: string = 'admin'
): Promise<FinancialStatement> {
    const res = await fetch(`${API_BASE}/api/financial/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            statement_id: statementId,
            edits,
            username,
        }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to save edits' }));
        throw new Error(err.detail || 'Failed to save edits');
    }
    return res.json();
}

export async function fetchFinancialStatement(statementId: number): Promise<FinancialStatement> {
    const res = await fetch(`${API_BASE}/api/financial/statement/${statementId}`);
    if (!res.ok) throw new Error('Statement not found');
    return res.json();
}

// ── Overview Edit Endpoints ──

export interface OverviewEditItem {
    field_path: string;
    old_value: string;
    new_value: string;
    comment: string;
}

export async function editOverview(
    runId: number,
    edits: OverviewEditItem[],
    username: string = 'admin'
): Promise<void> {
    const res = await fetch(`${API_BASE}/api/overview/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_id: runId, edits, username }),
    });
    if (!res.ok) throw new Error('Failed to save overview edits');
}

export async function fetchOverviewEdits(runId: number): Promise<any[]> {
    const res = await fetch(`${API_BASE}/api/overview/edits/${runId}`);
    if (!res.ok) throw new Error('Failed to fetch overview edits');
    return res.json();
}

// ── Comparison Endpoints ──

export async function fetchComparison(): Promise<ComparisonData> {
    const res = await fetch(`${API_BASE}/api/comparison`);
    if (!res.ok) throw new Error('Failed to fetch comparison data');
    return res.json();
}

// ── Currency Rate Endpoints ──


export async function fetchCurrencyRates(): Promise<any[]> {
    const res = await fetch(`${API_BASE}/api/currency-rates`);
    if (!res.ok) throw new Error('Failed to fetch currency rates');
    return res.json();
}

// ── Peer Rating Endpoints ──

export async function runPeerRating(companyName: string, peers: string[]): Promise<PeerRatingResult> {
    const res = await fetch(`${API_BASE}/api/peer-rating/${encodeURIComponent(companyName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peers }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Peer rating failed' }));
        throw new Error(err.detail || 'Peer rating failed');
    }
    return res.json();
}

export async function fetchPeerRating(companyName: string): Promise<PeerRatingResult> {
    const res = await fetch(`${API_BASE}/api/peer-rating/${encodeURIComponent(companyName)}`);
    if (!res.ok) throw new Error('No peer rating found');
    return res.json();
}
