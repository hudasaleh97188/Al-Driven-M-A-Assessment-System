import type { AnalysisData, AnalysisListItem, PeerRatingResult } from './types';

const API_BASE = 'http://localhost:5050';

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
