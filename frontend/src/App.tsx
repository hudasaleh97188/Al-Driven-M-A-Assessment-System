import React, { useState, useEffect } from 'react';
import { Upload, FileText, AlertTriangle, TrendingUp, Activity, PieChart, AlertCircle, TrendingDown, DollarSign, Plus, Calendar, Users, Building, Contact } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';

function YoYBadge({ current, previous, isRatio = false, isNegativeGood = false }) {
    if (previous === undefined || previous === null || current === undefined || current === null) return null;
    let diff = 0;
    let formatted = "";
    if (isRatio) {
        diff = current - previous;
        formatted = `${diff > 0 ? '+' : ''}${diff.toFixed(2)} pp`;
    } else {
        if (previous === 0) return null;
        diff = ((current - previous) / previous) * 100;
        formatted = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
    }

    if (Math.abs(diff) < 0.01) {
        return <span className="ml-2 text-[10px] font-medium text-gray-400 inline-flex items-center">(- 0%)</span>;
    }

    const isPositiveDiff = diff > 0;
    const isGood = isNegativeGood ? !isPositiveDiff : isPositiveDiff;

    const colorClass = isGood
        ? "bg-green-100 text-green-700"
        : "bg-red-100 text-red-700";

    return (
        <span className={`ml-3 px-2 py-0.5 text-[11px] font-semibold rounded-full ${colorClass} inline-flex items-center shadow-sm`}>
            {isPositiveDiff ? <TrendingUp size={12} className="mr-1" /> : <TrendingDown size={12} className="mr-1" />}
            {formatted}
        </span>
    );
}

function MetricCard({ title, value, delta, deltaPrefix = '', chartData, chartKey, isRatio = false, isNegativeGood = false, baselineYear = 'prev' }) {
    const isPositiveDelta = typeof delta === 'number' && delta >= 0;

    // Color: green = good, red = bad. For isNegativeGood metrics (Cost-to-Income, GNPA), going up is bad.
    let deltaColor = 'text-gray-500';
    if (delta !== undefined) {
        if (isNegativeGood) {
            deltaColor = isPositiveDelta ? 'text-red-500' : 'text-green-500';
        } else {
            deltaColor = isPositiveDelta ? 'text-green-500' : 'text-red-500';
        }
    }

    // For ratio metrics: show "p.p." (percentage points) for delta, "%" for the value.
    // For absolute metrics: show "%" for delta (it's a percentage change), no suffix for the value.
    const valueSuffix = isRatio ? '%' : '';
    const deltaSuffix = isRatio ? ' p.p.' : '%';

    return (
        <div className="bg-panel rounded-[24px] p-6 flex flex-col justify-between shadow-soft border border-gray-100 hover:shadow-card transition-shadow duration-300">
            <div>
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-gray-500 uppercase tracking-wider text-xs font-semibold">{title}</h3>
                </div>
                <div className="text-3xl font-bold text-gray-900 tracking-tight mb-2">
                    {value}{valueSuffix}
                </div>

                {delta !== undefined && (
                    <div className="flex items-center mt-3">
                        <span className={`px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-xs font-semibold flex items-center ${deltaColor}`}>
                            {isPositiveDelta ? <TrendingUp size={14} className="mr-1" /> : <TrendingDown size={14} className="mr-1" />}
                            {deltaPrefix}{Math.abs(delta).toFixed(1)}{deltaSuffix}
                            <span className="text-gray-400 ml-1.5 font-medium lowercase">vs {baselineYear}</span>
                        </span>
                    </div>
                )}
            </div>

            {chartData && chartData.length > 0 && (
                <div className="h-12 w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                            <Tooltip
                                cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
                                contentStyle={{ backgroundColor: '#0b101c', borderColor: '#334155', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                                itemStyle={{ color: '#fff' }}
                                labelStyle={{ display: 'none' }}
                                formatter={(value: any, _name: any, props: any) => [`${value}${valueSuffix}`, `${title} (${props.payload.name})`]}
                            />
                            <Bar dataKey={chartKey} radius={[2, 2, 0, 0]}>
                                {chartData.map((entry, index) => {
                                    let barColor = '#334155';
                                    if (index === chartData.length - 1) {
                                        if (isNegativeGood) {
                                            barColor = isPositiveDelta ? '#ef4444' : '#22c55e';
                                        } else {
                                            barColor = isPositiveDelta ? '#22c55e' : '#ef4444';
                                        }
                                    }
                                    return <Cell key={`cell-${index}`} fill={barColor} />;
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

function RiskCard({ risk }) {
    const getSeverityBadgeColor = (level) => {
        switch (level?.toLowerCase()) {
            case 'critical': return 'bg-red-100 text-red-700';
            case 'high': return 'bg-orange-100 text-orange-700';
            case 'medium': return 'bg-yellow-100 text-yellow-700';
            case 'low': return 'bg-green-100 text-green-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    return (
        <div
            className={`bg-panel border border-gray-100 rounded-[24px] p-6 shadow-soft hover:shadow-card transition-shadow duration-300`}
            style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.5fr)',
                gap: '1.5rem',
                alignItems: 'start',
            }}
        >
            {/* Column 1: Badge + Category + Description */}
            <div style={{ minWidth: 0 }}>
                <div className="flex items-center gap-3 mb-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0 whitespace-nowrap ${getSeverityBadgeColor(risk.severity_level)}`}>
                        {risk.severity_level}
                    </span>
                    <span className="text-gray-500 text-xs font-semibold uppercase tracking-wider" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{risk.category}</span>
                </div>
                <p className="text-gray-600 text-sm leading-relaxed" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{risk.description}</p>
            </div>

            {/* Column 2: Valuation Impact */}
            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 h-full" style={{ minWidth: 0 }}>
                <div className="flex items-start text-sm leading-relaxed text-gray-700">
                    <DollarSign className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0 text-blue-500" />
                    <span className="break-words w-full" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{risk.valuation_impact || "N/A"}</span>
                </div>
            </div>

            {/* Column 3: Negotiation Leverage */}
            <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100/50 h-full" style={{ minWidth: 0 }}>
                <div className="flex items-start text-sm leading-relaxed text-gray-700">
                    <FileText className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0 text-blue-500" />
                    <span className="break-words w-full" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{risk.negotiation_leverage_point || risk.negotiation_leverage || "N/A"}</span>
                </div>
            </div>
        </div>
    );
}

function RatioBar({ ratio }) {
    // Fill from left to right.
    // 0 -> 0% width, 1.0 -> 50% width, >= 2.0 -> 100% width.
    const fillPct = Math.min(100, Math.max(0, (ratio / 2) * 100));

    // Color logic: Orange (left) = liquidity risk (< 1.0), Blue = stability (>= 1.0)
    const barColor = ratio < 1.0 ? 'bg-orange-500' : 'bg-blue-500';

    return (
        <div className="bg-panel rounded-[24px] p-6 flex flex-col justify-between shadow-soft border border-gray-100 hover:shadow-card transition-shadow duration-300">
            <div>
                <div className="flex justify-between items-center mb-3">
                    <h3 className="text-gray-500 uppercase tracking-wider text-xs font-semibold">Depositors vs Borrowers</h3>
                </div>
                <div className="text-3xl font-bold text-gray-900 tracking-tight mb-2">{ratio.toFixed(2)}x</div>
            </div>

            <div className="mt-4">
                <div className="relative h-2 w-full bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden flex">
                    <div style={{ width: `${fillPct}%` }} className={`${barColor} h-full transition-all duration-500`}></div>
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white z-10 transform -translate-x-1/2 shadow-sm"></div>
                </div>

                <div className="flex justify-between mt-2 text-xs font-medium text-gray-400">
                    <span>Wholesale-Funded</span>
                    <span>1.0x Deposit-Neutral</span>
                    <span>Depositor-Funded</span>
                </div>
            </div>
        </div>
    );
}

export default function App() {
    const [companyName, setCompanyName] = useState('');
    const [files, setFiles] = useState<File[]>([]);
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<any>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        document.documentElement.classList.remove('dark');
    }, []);

    // Dashboard states
    const [history, setHistory] = useState<any[]>([]);
    const [showForm, setShowForm] = useState(false);

    const fetchHistory = async () => {
        try {
            const res = await fetch('http://localhost:5050/api/analyses');
            if (res.ok) {
                const hist = await res.json();
                setHistory(hist);
            }
        } catch (e) {
            console.error("Failed to fetch history", e);
        }
    };

    useEffect(() => {
        fetchHistory();
    }, [data, showForm]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            setFiles(Array.from(e.target.files));
        }
    };

    const handleAnalyze = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!companyName) {
            setError('Please provide a company name');
            return;
        }

        setLoading(true);
        setError('');

        try {
            if (files.length > 0) {
                const formData = new FormData();
                formData.append('company_name', companyName);
                files.forEach(f => formData.append('files', f));

                const res = await fetch('http://localhost:5050/api/analyze', {
                    method: 'POST',
                    body: formData,
                });

                if (!res.ok) {
                    const errDetail = await res.json();
                    throw new Error(errDetail.detail || 'Analysis failed');
                }

                const result = await res.json();
                setData(result);
                setShowForm(false);
            } else {
                // Otherwise try to GET the existing
                const res = await fetch(`http://localhost:5050/api/analysis/${encodeURIComponent(companyName)}`);
                if (!res.ok) {
                    throw new Error('Company not found and no files provided to analyze.');
                }
                const result = await res.json();
                setData(result);
                setShowForm(false);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const loadPastAnalysis = async (cName: string) => {
        setLoading(true);
        setError('');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        try {
            const res = await fetch(`http://localhost:5050/api/analysis/${encodeURIComponent(cName)}`);
            if (!res.ok) throw new Error('Failed to load past analysis');
            const result = await res.json();
            setData(result);
            setShowForm(false);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };


    // Safe accessor helpers
    const getLatest = (arr) => arr && arr.length > 0 ? arr[arr.length - 1] : {};
    const getFirst = (arr) => arr && arr.length > 0 ? arr[0] : {};
    const calcDelta = (latest, first) => latest && first && first !== 0 ? ((latest - first) / first) * 100 : 0;

    const latestFin = getLatest(data?.financial_data);
    const firstFin = getFirst(data?.financial_data);
    const currency = data?.currency || 'USD';

    return (
        <div className="min-h-screen p-8 max-w-7xl mx-auto">
            <header className="flex items-center justify-between mb-8">
                <div className="flex items-center cursor-pointer" onClick={() => { setData(null); setShowForm(false); }}>
                    <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center mr-3 font-bold text-white shadow-lg shadow-blue-500/20">
                        D
                    </div>
                    <h1 className="text-xl font-semibold tracking-wide text-gray-900">DealLens</h1>
                </div>
            </header>

            {/* DASHBOARD VIEW */}
            {!data && !showForm && (
                <div className="animate-in fade-in duration-700">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-4">

                        {/* Add New Document Card */}
                        <div
                            onClick={() => setShowForm(true)}
                            className="bg-green-50/30 hover:bg-green-50/80 border-2 border-dashed border-green-300 rounded-[24px] p-6 flex flex-col items-center justify-center cursor-pointer transition-colors min-h-[200px]"
                        >
                            <div className="bg-[#22c55e] text-white rounded-full p-3 mb-4 flex items-center justify-center shadow-sm">
                                <Plus size={24} strokeWidth={3} />
                            </div>
                            <span className="text-green-600 font-semibold text-sm">New Document</span>
                        </div>

                        {/* History Cards */}
                        {history.map((item, idx) => (
                            <div
                                key={idx}
                                onClick={() => loadPastAnalysis(item.company_name)}
                                className="bg-white border border-gray-300 hover:border-gray-400 rounded-[24px] p-6 flex flex-col justify-between cursor-pointer transition-all hover:shadow-soft min-h-[200px]"
                            >
                                <div className="flex justify-between items-start mb-4">
                                    <span className="text-xs font-semibold px-2 py-1 bg-green-100 text-green-700 rounded block">
                                        Analyzed
                                    </span>
                                    <span className="text-xs text-gray-500 font-medium">
                                        {new Date(item.analyzed_at).toLocaleDateString('en-GB')}
                                    </span>
                                </div>
                                <div className="text-center mt-auto mb-auto">
                                    <h3 className="text-xl font-bold text-gray-900 capitalize">{item.company_name}</h3>
                                </div>
                                <div className="flex justify-end mt-4 text-gray-400">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* UPLOAD FORM VIEW */}
            {!data && showForm && (
                <form onSubmit={handleAnalyze} className="animate-in fade-in slide-in-from-bottom-4 bg-panel border border-gray-200 dark:border-gray-800 rounded-2xl p-8 max-w-xl mx-auto mt-20 shadow-2xl">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Analyze Target Company</h2>
                        <button type="button" onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">Cancel</button>
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-2">Company Name</label>
                        <input
                            type="text"
                            value={companyName}
                            onChange={e => setCompanyName(e.target.value)}
                            className="w-full bg-white dark:bg-[#0b101c] border border-gray-300 dark:border-gray-700 rounded-lg px-4 py-3 text-gray-900 dark:text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                            placeholder="e.g. Baobab Group"
                        />
                    </div>

                    <div className="mb-8">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-400 mb-2">Upload Annual Reports (PDF)</label>
                        <div className="relative border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center hover:border-blue-500 transition-colors bg-gray-50 dark:bg-[#0b101c]">
                            <input
                                type="file"
                                multiple
                                accept=".pdf"
                                onChange={handleFileChange}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            />
                            <Upload className="mx-auto h-8 w-8 text-gray-400 dark:text-gray-500 mb-3" />
                            <p className="text-sm text-gray-500 dark:text-gray-400">Drag & drop PDFs here or click to browse</p>
                            {files.length > 0 && (
                                <div className="mt-4 text-xs text-blue-500 dark:text-blue-400 font-medium">
                                    {files.length} file(s) selected
                                </div>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-lg flex items-start text-red-400 text-sm">
                            <AlertCircle size={16} className="mr-2 mt-0.5 shrink-0" />
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors flex justify-center items-center"
                    >
                        {loading ? (
                            <span className="flex items-center">
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Processing AI Extraction...
                            </span>
                        ) : 'Run Analysis'}
                    </button>
                </form>
            )}

            {/* METRIC ANALYSIS VIEW */}
            {data && (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div className="flex justify-between items-end mb-12 border-b border-gray-100 pb-8">
                        <div>
                            <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-4 capitalize">{data.company_name}</h1>
                            <div className="flex flex-wrap items-center gap-3 text-sm">
                                {latestFin?.operational_scale?.number_of_employees && (
                                    <div className="flex items-center text-gray-500 border border-gray-200 bg-white px-4 py-1.5 rounded-full font-medium shadow-sm">
                                        <Users size={14} className="mr-2 opacity-60" />
                                        <span><span className="font-semibold text-gray-900 mr-1">{latestFin.operational_scale.number_of_employees.toLocaleString()}</span>Employees</span>
                                    </div>
                                )}
                                {latestFin?.operational_scale?.number_of_branches && (
                                    <div className="flex items-center text-gray-500 border border-gray-200 bg-white px-4 py-1.5 rounded-full font-medium shadow-sm">
                                        <Building size={14} className="mr-2 opacity-60" />
                                        <span><span className="font-semibold text-gray-900 mr-1">{latestFin.operational_scale.number_of_branches}</span>Branches</span>
                                    </div>
                                )}
                                {latestFin?.operational_scale?.number_of_borrowers && (
                                    <div className="flex items-center text-gray-500 border border-gray-200 bg-white px-4 py-1.5 rounded-full font-medium shadow-sm">
                                        <Contact size={14} className="mr-2 opacity-60" />
                                        <span><span className="font-semibold text-gray-900 mr-1">{latestFin.operational_scale.number_of_borrowers.toLocaleString()}</span>Borrowers</span>
                                    </div>
                                )}
                                {latestFin?.year && (
                                    <div className="flex items-center text-gray-500 border border-gray-200 bg-white px-4 py-1.5 rounded-full font-medium shadow-sm">
                                        <Calendar size={14} className="mr-2 opacity-60" />
                                        <span><span className="font-semibold text-gray-900 mr-1">Year</span>{latestFin.year}</span>
                                    </div>
                                )}
                                {currency && (
                                    <div className="flex items-center text-gray-500 border border-gray-200 bg-white px-4 py-1.5 rounded-full font-medium shadow-sm">
                                        <DollarSign size={14} className="mr-2 opacity-60" />
                                        <span><span className="font-semibold text-gray-900 mr-1">{currency}</span>Currency</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => { setData(null); setShowForm(false); }}
                            className="px-5 py-2.5 bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors text-sm font-semibold text-gray-700 shadow-sm"
                        >
                            Back to Dashboard
                        </button>

                    </div>

                    {/* Absolute Health (2024 Est.) */}
                    <div className="mb-10">
                        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center">
                            <div className="w-1 h-4 bg-blue-500 mr-2 rounded"></div>
                            Absolute Health
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                            <MetricCard
                                title="Revenue"
                                value={latestFin?.general_financials?.revenue}
                                delta={calcDelta(latestFin?.general_financials?.revenue, firstFin?.general_financials?.revenue)}
                                chartData={data.financial_data.map(d => ({ name: d.year, val: d.general_financials?.revenue }))}
                                chartKey="val"
                                baselineYear={firstFin?.year}
                            />
                            <MetricCard
                                title="EBITDA"
                                value={latestFin?.general_financials?.ebitda}
                                delta={calcDelta(latestFin?.general_financials?.ebitda, firstFin?.general_financials?.ebitda)}
                                chartData={data.financial_data.map(d => ({ name: d.year, val: d.general_financials?.ebitda }))}
                                chartKey="val"
                                baselineYear={firstFin?.year}
                            />
                            <MetricCard
                                title="PAT"
                                value={latestFin?.general_financials?.pat}
                                delta={calcDelta(latestFin?.general_financials?.pat, firstFin?.general_financials?.pat)}
                                chartData={data.financial_data.map(d => ({ name: d.year, val: d.general_financials?.pat }))}
                                chartKey="val"
                                baselineYear={firstFin?.year}
                            />
                            <MetricCard
                                title="Total Equity"
                                value={latestFin?.capital_and_funding?.total_equity}
                                delta={calcDelta(latestFin?.capital_and_funding?.total_equity, firstFin?.capital_and_funding?.total_equity)}
                                chartData={data.financial_data.map(d => ({ name: d.year, val: d.capital_and_funding?.total_equity }))}
                                chartKey="val"
                                baselineYear={firstFin?.year}
                            />
                            {/* Credit Rating - Horizontal bars with tooltips */}
                            <div className="bg-panel rounded-[24px] p-6 flex flex-col justify-between shadow-soft border border-gray-100 hover:shadow-card transition-shadow duration-300">
                                <div>
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-gray-500 uppercase tracking-wider text-xs font-semibold">Credit Rating</h3>
                                    </div>
                                    <div className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight mb-2 break-words leading-tight pr-2">
                                        {latestFin?.capital_and_funding?.credit_rating || 'N/A'}
                                    </div>
                                </div>
                                <div className="flex gap-1.5 mt-4 items-end">
                                    {data.financial_data.map((d, i) => (
                                        <div key={i} className="group relative flex-1">
                                            <div className="h-2 rounded-full bg-gray-200 w-full transition-colors hover:bg-gray-400 cursor-pointer"></div>
                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                                                {d.year}: {d.capital_and_funding?.credit_rating || 'N/A'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Operating Metrics */}
                    <div className="mb-10">
                        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center">
                            <div className="w-1 h-4 bg-purple-500 mr-2 rounded"></div>
                            Operating Metrics
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <MetricCard
                                title="Net Interest Margin"
                                value={latestFin?.loan_book?.nim_percent}
                                isRatio={true}
                                delta={latestFin?.loan_book?.nim_percent - firstFin?.loan_book?.nim_percent}
                                deltaPrefix="+"
                                chartData={data.financial_data.map((d: any) => ({ name: d.year, val: d.loan_book?.nim_percent }))}
                                chartKey="val"
                                isNegativeGood={false}
                                baselineYear={firstFin?.year}
                            />
                            <MetricCard
                                title="Cost-to-Income"
                                value={latestFin?.general_financials?.cost_to_income_ratio_percent}
                                isRatio={true}
                                delta={latestFin?.general_financials?.cost_to_income_ratio_percent - firstFin?.general_financials?.cost_to_income_ratio_percent}
                                deltaPrefix="+"
                                chartData={data.financial_data.map((d: any) => ({ name: d.year, val: d.general_financials?.cost_to_income_ratio_percent }))}
                                chartKey="val"
                                isNegativeGood={true}
                                baselineYear={firstFin?.year}
                            />
                            <MetricCard
                                title="GNPA Ratio"
                                value={latestFin?.loan_book?.npl_ratio_percent || latestFin?.loan_book?.gnpa_percent}
                                isRatio={true}
                                delta={(latestFin?.loan_book?.npl_ratio_percent || latestFin?.loan_book?.gnpa_percent) - (firstFin?.loan_book?.npl_ratio_percent || firstFin?.loan_book?.gnpa_percent)}
                                chartData={data.financial_data.map((d: any) => ({ name: d.year, val: d.loan_book?.npl_ratio_percent || d.loan_book?.gnpa_percent }))}
                                chartKey="val"
                                isNegativeGood={true}
                                baselineYear={firstFin?.year}
                            />
                        </div>
                    </div>

                    {/* Loan Book */}
                    <div className="mb-10">
                        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center">
                            <div className="w-1 h-4 bg-teal-500 mr-2 rounded"></div>
                            Loan Book
                        </h2>
                        <div className="bg-panel rounded-[24px] overflow-hidden shadow-soft border border-gray-100 p-2">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse whitespace-nowrap">
                                    <thead>
                                        <tr className="border-b border-gray-100 text-gray-500 text-xs font-semibold uppercase tracking-wider">
                                            <th className="p-5">Metric</th>
                                            {data.financial_data.map((d: any) => (
                                                <th key={d.year} className="p-5 text-right">{d.year}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="text-sm divide-y divide-gray-50">
                                        <tr className="hover:bg-gray-50/50 transition-colors group">
                                            <td className="p-5 text-gray-600 font-medium">Loan Outstanding</td>
                                            {data.financial_data.map((d: any, i: number) => (
                                                <td key={d.year} className="p-5 text-right font-semibold text-gray-900">
                                                    {d.loan_book?.total_loan_outstanding?.toLocaleString() || '-'}
                                                    {i > 0 && <YoYBadge current={d.loan_book?.total_loan_outstanding} previous={data.financial_data[i - 1].loan_book?.total_loan_outstanding} isNegativeGood={false} />}
                                                </td>
                                            ))}
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 transition-colors group">
                                            <td className="p-5 text-gray-600 font-medium">AUM</td>
                                            {data.financial_data.map((d: any, i: number) => (
                                                <td key={d.year} className="p-5 text-right font-semibold text-gray-900">
                                                    {d.loan_book?.aum?.toLocaleString() || '-'}
                                                    {i > 0 && <YoYBadge current={d.loan_book?.aum} previous={data.financial_data[i - 1].loan_book?.aum} isNegativeGood={false} />}
                                                </td>
                                            ))}
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 transition-colors group">
                                            <td className="p-5 text-gray-600 font-medium">GNPA / NPL (%)</td>
                                            {data.financial_data.map((d: any, i: number) => {
                                                const val = d.loan_book?.npl_ratio_percent || d.loan_book?.gnpa_percent;
                                                const prevVal = data.financial_data[i - 1]?.loan_book?.npl_ratio_percent || data.financial_data[i - 1]?.loan_book?.gnpa_percent;
                                                return <td key={d.year} className="p-5 text-right font-semibold text-gray-900">
                                                    {val !== undefined && val !== null ? `${val}%` : '-'}
                                                    {i > 0 && <YoYBadge current={val} previous={prevVal} isRatio={true} isNegativeGood={true} />}
                                                </td>;
                                            })}
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 transition-colors group">
                                            <td className="p-5 text-gray-600 font-medium">PAR 30 (%)</td>
                                            {data.financial_data.map((d: any, i: number) => (
                                                <td key={d.year} className="p-5 text-right font-semibold text-gray-900">
                                                    {d.loan_book?.par_30_percent !== undefined && d.loan_book?.par_30_percent !== null ? `${d.loan_book.par_30_percent}%` : '-'}
                                                    {i > 0 && <YoYBadge current={d.loan_book?.par_30_percent} previous={data.financial_data[i - 1].loan_book?.par_30_percent} isRatio={true} isNegativeGood={true} />}
                                                </td>
                                            ))}
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 transition-colors group">
                                            <td className="p-5 text-gray-600 font-medium">Provision Coverage (%)</td>
                                            {data.financial_data.map((d: any, i: number) => (
                                                <td key={d.year} className="p-5 text-right font-semibold text-gray-900">
                                                    {d.loan_book?.provision_coverage_percent !== undefined && d.loan_book?.provision_coverage_percent !== null ? `${d.loan_book.provision_coverage_percent}%` : '-'}
                                                    {i > 0 && <YoYBadge current={d.loan_book?.provision_coverage_percent} previous={data.financial_data[i - 1].loan_book?.provision_coverage_percent} isRatio={true} isNegativeGood={false} />}
                                                </td>
                                            ))}
                                        </tr>
                                        <tr className="hover:bg-gray-50/50 transition-colors group">
                                            <td className="p-5 text-gray-600 font-medium">Disbursals</td>
                                            {data.financial_data.map((d: any, i: number) => (
                                                <td key={d.year} className="p-5 text-right font-semibold text-gray-900">
                                                    {d.capital_and_funding?.disbursals?.toLocaleString() || '-'}
                                                    {i > 0 && <YoYBadge current={d.capital_and_funding?.disbursals} previous={data.financial_data[i - 1].capital_and_funding?.disbursals} isNegativeGood={false} />}
                                                </td>
                                            ))}
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Profitability & Returns */}
                    <div className="mb-10">
                        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 flex items-center">
                            <div className="w-1 h-4 bg-orange-500 mr-2 rounded"></div>
                            Profitability & Capital Returns
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <MetricCard
                                title="Profit Margin"
                                value={latestFin?.general_financials?.profit_margin_percent}
                                isRatio={true}
                                delta={latestFin?.general_financials?.profit_margin_percent - firstFin?.general_financials?.profit_margin_percent}
                                chartData={data.financial_data.map(d => ({ name: d.year, val: d.general_financials?.profit_margin_percent }))}
                                chartKey="val"
                                baselineYear={firstFin?.year}
                            />
                            <MetricCard
                                title="CAR Tier 1"
                                value={latestFin?.capital_and_funding?.car_tier_1_percent}
                                isRatio={true}
                                delta={latestFin?.capital_and_funding?.car_tier_1_percent - firstFin?.capital_and_funding?.car_tier_1_percent}
                                deltaPrefix="+"
                                chartData={data.financial_data.map(d => ({ name: d.year, val: d.capital_and_funding?.car_tier_1_percent }))}
                                chartKey="val"
                                isNegativeGood={false}
                                baselineYear={firstFin?.year}
                            />
                            <div className="bg-panel rounded-[24px] p-6 flex flex-col justify-between shadow-soft border border-gray-100 hover:shadow-card transition-shadow duration-300">
                                <div>
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 className="text-gray-500 uppercase tracking-wider text-xs font-semibold">ROE & ROA</h3>
                                    </div>
                                    <div className="flex gap-8 mt-2">
                                        <div>
                                            <div className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wider">ROE</div>
                                            <div className="text-3xl font-bold text-gray-900 tracking-tight">{latestFin?.general_financials?.roe_percent}%</div>
                                        </div>
                                        <div>
                                            <div className="text-xs text-gray-500 font-semibold mb-1 uppercase tracking-wider">ROA</div>
                                            <div className="text-3xl font-bold text-gray-900 tracking-tight">{latestFin?.general_financials?.roa_percent}%</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <RatioBar ratio={parseFloat(latestFin?.capital_and_funding?.depositors_vs_borrowers_ratio) || 0.55} />
                        </div>
                    </div>

                    {/* Risks & Anomalies */}
                    <div className="mb-10">
                        <div className="flex items-center mb-6">
                            <div className="w-8 h-8 rounded-lg bg-red-100 text-red-500 flex items-center justify-center mr-3 shadow-sm">
                                <AlertTriangle size={18} />
                            </div>
                            <h2 className="text-xl font-bold text-gray-900">Identified Risks & Anomalies</h2>
                            <span className="ml-3 text-xs font-semibold px-2.5 py-1 bg-red-100 text-red-600 rounded-full border border-red-200">
                                {data.anomalies_and_risks.length} items
                            </span>
                        </div>

                        {/* Column Headers for Risks */}
                        <div
                            className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3 px-6"
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1.5fr)',
                                gap: '1.5rem',
                            }}
                        >
                            <div>DESCRIPTION & IMPACT</div>
                            <div style={{ paddingLeft: '1.5rem' }}>VALUATION IMPACT</div>
                            <div>NEGOTIATION LEVERAGE</div>
                        </div>

                        <div className="flex flex-col gap-4 max-h-[600px] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent' }}>
                            {data.anomalies_and_risks.map((risk, i) => (
                                <RiskCard key={i} risk={risk} />
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
