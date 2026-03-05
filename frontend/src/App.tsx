import { useState, useEffect } from 'react';
import { fetchAnalyses, fetchAnalysis, runAnalysis } from './api';
import type { AnalysisData, AnalysisListItem } from './types';

import Dashboard from './components/Dashboard';
import UploadForm from './components/UploadForm';
import BusinessOverview from './pages/BusinessOverview';
import FinancialHealth from './pages/FinancialHealth';
import RatingComparison from './pages/RatingComparison';

type Tab = 'overview' | 'financial' | 'rating';

const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Business Overview' },
    { key: 'financial', label: 'Financial Health' },
    { key: 'rating', label: 'Rating & Comparison' },
];

export default function App() {
    const [data, setData] = useState<AnalysisData | null>(null);
    const [history, setHistory] = useState<AnalysisListItem[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [tab, setTab] = useState<Tab>('overview');

    // Fetch history on mount and after data changes
    useEffect(() => {
        fetchAnalyses().then(setHistory).catch(() => { });
    }, [data, showForm]);

    const handleLoadCompany = async (name: string) => {
        setLoading(true);
        setError('');
        try {
            const result = await fetchAnalysis(name);
            setData(normalise(result));
            setTab('overview');
            setShowForm(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (companyName: string, files: File[]) => {
        setLoading(true);
        setError('');
        try {
            if (files.length > 0) {
                const result = await runAnalysis(companyName, files);
                setData(normalise(result));
            } else {
                const result = await fetchAnalysis(companyName);
                setData(normalise(result));
            }
            setTab('overview');
            setShowForm(false);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const goHome = () => { setData(null); setShowForm(false); };

    return (
        <div className="min-h-screen">
            {/* ──── Header ──── */}
            <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100">
                <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-3 cursor-pointer" onClick={goHome}>
                        <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-blue-500/20">D</div>
                        <span className="text-base font-bold tracking-wide text-gray-900">DealLens</span>
                    </div>

                    {data && (
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-gray-400 font-medium capitalize hidden sm:inline">{data.company_name}</span>
                            <button
                                onClick={goHome}
                                className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-semibold text-gray-600 transition-colors"
                            >
                                ← Dashboard
                            </button>
                        </div>
                    )}
                </div>

                {/* Tab bar */}
                {data && (
                    <div className="max-w-7xl mx-auto px-6">
                        <nav className="flex gap-1 -mb-px">
                            {TABS.map(t => (
                                <button
                                    key={t.key}
                                    onClick={() => setTab(t.key)}
                                    className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${tab === t.key
                                        ? 'text-blue-600'
                                        : 'text-gray-400 hover:text-gray-600'
                                        }`}
                                >
                                    {t.label}
                                    {tab === t.key && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-full" />
                                    )}
                                </button>
                            ))}
                        </nav>
                    </div>
                )}
            </header>

            {/* ──── Content ──── */}
            <main className="max-w-7xl mx-auto px-6 py-8">
                {/* Dashboard */}
                {!data && !showForm && (
                    <Dashboard history={history} onNewDocument={() => setShowForm(true)} onSelectCompany={handleLoadCompany} />
                )}

                {/* Upload form */}
                {!data && showForm && (
                    <UploadForm onSubmit={handleSubmit} onCancel={() => setShowForm(false)} loading={loading} error={error} />
                )}

                {/* Loading overlay */}
                {loading && data === null && !showForm && (
                    <div className="flex justify-center items-center py-32">
                        <svg className="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                    </div>
                )}

                {/* Analysis pages */}
                {data && (
                    <div>
                        {/* Company header */}
                        <div className="mb-8">
                            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2 capitalize">{data.company_name}</h1>
                            <div className="flex flex-wrap gap-2">
                                {data.company_id && (
                                    <span className="px-3 py-1 bg-violet-50 text-violet-700 rounded-full text-xs font-medium border border-violet-100">
                                        ID: {data.company_id}
                                    </span>
                                )}
                                {data.currency && (
                                    <span className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium border border-blue-100">
                                        {data.currency}
                                    </span>
                                )}
                                {data.financial_data?.length > 0 && (
                                    <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                                        {data.financial_data[0].year} – {data.financial_data[data.financial_data.length - 1].year}
                                    </span>
                                )}
                                {data.company_overview?.operational_scale?.number_of_employees && (
                                    <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                                        {(Math.floor(data.company_overview.operational_scale.number_of_employees / 10) * 10).toLocaleString()}+ employees
                                    </span>
                                )}
                                {data.company_overview?.countries_of_operation && (
                                    <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-xs font-medium">
                                        {data.company_overview.countries_of_operation.length} countries
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Active page */}
                        {tab === 'overview' && <BusinessOverview data={data} />}
                        {tab === 'financial' && <FinancialHealth data={data} />}
                        {tab === 'rating' && <RatingComparison data={data} />}
                    </div>
                )}
            </main>
        </div>
    );
}

/* Normalisation helper for backward compat with old DB records */
function normalise(result: any): AnalysisData {
    if (result?.financial_data) {
        result.financial_data = result.financial_data
            .map((d: any) => {
                if (!d.financial_health && (d.general_financials || d.loan_book || d.capital_and_funding)) {
                    d.financial_health = { ...(d.general_financials || {}), ...(d.loan_book || {}), ...(d.capital_and_funding || {}) };
                }
                return d;
            })
            // Always sort oldest → newest so latest = last element
            .sort((a: any, b: any) => a.year - b.year);
    }
    return result;
}
