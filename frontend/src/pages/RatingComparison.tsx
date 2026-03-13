import React, { useState, useEffect } from 'react';
import {
    Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
    Line, ComposedChart, Legend, Cell, Bar,
} from 'recharts';
import { ShieldAlert, Play, Loader2, Trophy, Target, BarChart3, Settings2, UserPlus, X, DollarSign, Edit3 } from 'lucide-react';
import { runPeerRating, fetchPeerRating, fetchAnalyses, fetchComparison, setCurrencyRate } from '../api';
import type { AnalysisData, PeerRatingResult, CriterionScore, AnalysisListItem, ComparisonData } from '../types';

/* ── colour helpers (1–5 scale) ── */
const scoreColor = (s: number) =>
    s >= 4 ? '#10b981' : s >= 3 ? '#f59e0b' : '#ef4444';

const scoreGradient = (s: number) =>
    s >= 4 ? 'from-emerald-500 to-emerald-400' :
        s >= 3 ? 'from-amber-500 to-amber-400' :
            'from-red-500 to-red-400';

const verdictFromScore = (s: number) =>
    s >= 4.0 ? 'Strong Acquisition Target' :
        s >= 3.25 ? 'Conditional Acquisition Target' :
            s >= 2.5 ? 'Moderate Acquisition Target' :
                'Weak Acquisition Target';

const verdictColor = (v: string) =>
    v.includes('Strong') ? 'text-emerald-600' :
        v.includes('Conditional') ? 'text-amber-600' :
            v.includes('Moderate') ? 'text-blue-600' : 'text-red-600';

const CRITERIA_ORDER = [
    'Contribution to Profitability',
    'Size of Transaction',
    'Geographic / Strategic Fit',
    'Product / Market Strategy Fit',
    'Ease of Execution',
    'Quality & Depth of Management',
    'Strategic Partners',
    'Quality of IT & Data',
    'Competitor Positioning',
];

const CRITERIA_SHORT = [
    'Profitability', 'Scale', 'Geo Fit', 'Product Fit', 'Execution',
    'Management', 'Partners', 'IT & Data', 'Competitor',
];

const COMPANY_COLORS = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
    '#06b6d4', '#ef4444', '#6366f1', '#14b8a6', '#f97316',
];

/* Default weights (sum to 9.0) */
const DEFAULT_WEIGHTS: { [key: string]: number } = {
    [CRITERIA_ORDER[0]]: 1.1,
    [CRITERIA_ORDER[1]]: 1.1,
    [CRITERIA_ORDER[2]]: 1.1,
    [CRITERIA_ORDER[3]]: 1.1,
    [CRITERIA_ORDER[4]]: 1.0,
    [CRITERIA_ORDER[5]]: 0.9,
    [CRITERIA_ORDER[6]]: 0.9,
    [CRITERIA_ORDER[7]]: 0.9,
    [CRITERIA_ORDER[8]]: 0.9,
};

const METRIC_TIERS = [
    {
        name: 'Strategic Fit',
        description: 'Tier 1: Core strategic alignment',
        metrics: CRITERIA_ORDER.slice(0, 4),
    },
    {
        name: 'Execution Complexity & Transactional Risk',
        description: 'Tier 2: Operational and deal complexity',
        metrics: CRITERIA_ORDER.slice(4, 7),
    },
    {
        name: 'Platform Quality',
        description: 'Tier 3: Technological and market standing',
        metrics: CRITERIA_ORDER.slice(7, 9),
    },
];

type SubTab = 'rating' | 'comparison';

interface Props {
    data: AnalysisData;
}

function fmtUSD(v: number | null | undefined): string {
    if (v === null || v === undefined || isNaN(v)) return 'N/A';
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(2)}`;
    return v.toFixed(2);
}



export default function RatingComparison({ data }: Props) {
    const [compData, setCompData] = useState<ComparisonData | null>(null);
    const [loadingComp, setLoadingComp] = useState(true);

    useEffect(() => {
        fetchComparison()
            .then(d => { setCompData(d); setLoadingComp(false); })
            .catch(e => { console.error("Comparison load error:", e); setLoadingComp(false); });
    }, []);

    return (
        <div className="space-y-6">
            <RatingTab data={data} compData={compData} loadingComp={loadingComp} />
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════
   RATING TAB (existing M&A Rating functionality with Comparison merged)
   ══════════════════════════════════════════════════════════════════════ */

function RatingTab({ data, compData, loadingComp }: { data: AnalysisData, compData: ComparisonData | null, loadingComp: boolean }) {
    const [peerData, setPeerData] = useState<PeerRatingResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [initializing, setInitializing] = useState(true);
    const [visible, setVisible] = useState(false);
    const [animated, setAnimated] = useState(false);
    const [error, setError] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [weights, setWeights] = useState<{ [key: string]: number }>({ ...DEFAULT_WEIGHTS });
    const [editingWeights, setEditingWeights] = useState(false);
    const [draftWeights, setDraftWeights] = useState<{ [key: string]: number }>({ ...DEFAULT_WEIGHTS });
    const [availableCompanies, setAvailableCompanies] = useState<AnalysisListItem[]>([]);
    const [selectedPeers, setSelectedPeers] = useState<string[]>([]);
    const [peerDropdownOpen, setPeerDropdownOpen] = useState(false);
    const [expandedTiers, setExpandedTiers] = useState<Record<string, boolean>>({
        [METRIC_TIERS[0].name]: true,
        [METRIC_TIERS[1].name]: true,
        [METRIC_TIERS[2].name]: true,
    });

    const toggleTier = (tier: string) => {
        setExpandedTiers(prev => ({ ...prev, [tier]: !prev[tier] }));
    };

    useEffect(() => {
        fetchAnalyses()
            .then(list => setAvailableCompanies(list.filter(c => c.company_name !== data.company_name)))
            .catch(() => { });
    }, [data.company_name]);

    const handleRun = async (peers: string[] = selectedPeers) => {
        setLoading(true);
        setError('');
        try {
            const result = await runPeerRating(data.company_name, peers);
            setPeerData(result);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
            setLoaded(true);
        }
    };

    const handleLoad = async () => {
        setError('');
        try {
            const result = await fetchPeerRating(data.company_name);
            setPeerData(result);
            if (result?.companies) {
                const peerNames = result.companies.map(c => c.company_name).filter(n => n !== data.company_name);
                setSelectedPeers(peerNames);
            }
            setLoaded(true);
        } catch {
            setLoaded(true);
        } finally {
            setInitializing(false);
            requestAnimationFrame(() => {
                setVisible(true);
                setTimeout(() => setAnimated(true), 50);
            });
        }
    };

    useEffect(() => {
        if (!loaded) handleLoad();
    }, []);

    const addPeer = async (name: string) => {
        if (!selectedPeers.includes(name)) {
            setSelectedPeers(prev => [...prev, name]);
            setPeerDropdownOpen(false);
            try {
                const peerResult = await fetchPeerRating(name);
                if (peerResult && peerResult.companies?.length > 0) {
                    setPeerData((prev: any) => {
                        if (!prev) return prev;
                        const newCompanies = [...prev.companies];
                        if (!newCompanies.find((c: any) => c.company_name === name)) {
                            newCompanies.push(peerResult.companies[0]);
                        }
                        return { ...prev, companies: newCompanies, scores: { ...prev.scores, ...peerResult.scores }, overall_scores: { ...prev.overall_scores, ...peerResult.overall_scores }, summaries: { ...prev.summaries, ...peerResult.summaries } };
                    });
                }
            } catch (err) {
                setSelectedPeers(prev => prev.filter(n => n !== name));
            }
        }
    };

    const removePeer = (name: string) => {
        setSelectedPeers(prev => prev.filter(n => n !== name));
        setPeerData((prev: any) => {
            if (!prev) return prev;
            const newScores = { ...prev.scores }; delete newScores[name];
            const newOverall = { ...prev.overall_scores }; delete newOverall[name];
            const newSummaries = { ...prev.summaries }; delete newSummaries[name];
            return { ...prev, companies: prev.companies.filter((c: any) => c.company_name !== name), scores: newScores, overall_scores: newOverall, summaries: newSummaries };
        });
    };

    const weightsTotal = Math.round(Object.values(draftWeights).reduce((a, b) => a + b, 0) * 10) / 10;
    const weightsValid = weightsTotal === 9.0;
    const applyWeights = () => { setWeights({ ...draftWeights }); setEditingWeights(false); };
    const resetWeights = () => { setDraftWeights({ ...DEFAULT_WEIGHTS }); setWeights({ ...DEFAULT_WEIGHTS }); setEditingWeights(false); };

    const computeWeightedScore = (company: string): number => {
        const cScores = peerData?.scores[company] ?? [];
        let totalWeighted = 0, totalWeight = 0;
        for (const criterion of CRITERIA_ORDER) {
            const w = weights[criterion] ?? 0;
            const s = cScores.find(sc => sc.criterion === criterion)?.score ?? 0;
            totalWeighted += s * w;
            totalWeight += w;
        }
        return totalWeight > 0 ? totalWeighted / totalWeight : 0;
    };

    if (!initializing && !peerData && !loading) {
        return (
            <div className="animate-in fade-in duration-500">
                {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm border border-red-100">{error}</div>}
                <div className="flex flex-col items-center justify-center min-h-[400px] text-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/50 p-8">
                    <ShieldAlert className="w-12 h-12 text-gray-300 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900 mb-2">M&A Rating Not Available</h2>
                    <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
                        Run the rating to score {data.company_name} on {CRITERIA_ORDER.length} M&A attractiveness criteria.
                    </p>
                    <PeerSelector availableCompanies={availableCompanies} selectedPeers={selectedPeers} peerDropdownOpen={peerDropdownOpen} setPeerDropdownOpen={setPeerDropdownOpen} addPeer={addPeer} removePeer={removePeer} />
                    <button onClick={() => handleRun()} disabled={loading} className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 mt-4">
                        <Play className="w-4 h-4" />
                        Run Rating{selectedPeers.length > 0 ? ` (+ ${selectedPeers.length} peers)` : ''}
                    </button>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center min-h-[400px] text-center p-8">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
                <h2 className="text-lg font-bold text-gray-900 mb-2">Scoring...</h2>
                <p className="text-gray-500 text-sm max-w-sm">Computing M&A attractiveness scores. This may take 1-2 minutes.</p>
            </div>
        );
    }

    if (initializing || !peerData) return null;

    const targetName = peerData.target_company;
    const targetOverall = computeWeightedScore(targetName);

    const getScore = (company: string, criterion: string): number => {
        return (peerData.scores[company] ?? []).find(s => s.criterion === criterion)?.score ?? 0;
    };
    const getTierAverage = (company: string, tierMetrics: string[]): number => {
        const scores = tierMetrics.map(m => getScore(company, m));
        return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    };

    const targetTier1Avg = getTierAverage(targetName, METRIC_TIERS[0].metrics);
    const isFlagged = targetTier1Avg <= 3;

    const targetVerdict = isFlagged ? 'Not worth progressing (Failed T1 Gating)' : verdictFromScore(targetOverall);
    const targetSummary = peerData.summaries[targetName] ?? '';
    const companies = peerData.companies ?? [];
    const companyNames = companies.map(c => c.company_name);
    const hasPeers = companyNames.length > 1;

    const getScoreDetail = (company: string, criterion: string): CriterionScore | undefined => {
        return (peerData.scores[company] ?? []).find(s => s.criterion === criterion);
    };

    const radarData = CRITERIA_ORDER.map((c, i) => {
        const entry: any = { criterion: CRITERIA_SHORT[i], [targetName]: getScore(targetName, c) };
        if (hasPeers) {
            const peerScores = companyNames.filter(n => n !== targetName).map(n => getScore(n, c));
            entry['Peer Average'] = peerScores.length > 0 ? Math.round((peerScores.reduce((a, b) => a + b, 0) / peerScores.length) * 10) / 10 : 0;
        }
        return entry;
    });

    return (
        <div className={`space-y-8 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}>
            {/* Action bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <PeerSelector availableCompanies={availableCompanies} selectedPeers={selectedPeers} peerDropdownOpen={peerDropdownOpen} setPeerDropdownOpen={setPeerDropdownOpen} addPeer={addPeer} removePeer={removePeer} />
                <button onClick={() => { setDraftWeights({ ...weights }); setEditingWeights(!editingWeights); }} className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-semibold text-gray-600 transition-colors">
                    <Settings2 className="w-3 h-3" />
                    {editingWeights ? 'Cancel Weights' : 'Edit Weights'}
                </button>
            </div>

            {/* Weights Editor */}
            {editingWeights && (
                <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-6">
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2"><Settings2 className="w-4 h-4" />Criteria Weights (must sum to 9.0)</h3>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                        {CRITERIA_ORDER.map(criterion => (
                            <div key={criterion} className="flex flex-col gap-1">
                                <label className="text-[11px] font-medium text-gray-600 truncate" title={criterion}>{criterion}</label>
                                <input type="number" step="0.1" min={0} max={9} value={draftWeights[criterion] ?? 0} onChange={e => setDraftWeights(prev => ({ ...prev, [criterion]: parseFloat(e.target.value) || 0 }))} className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all" />
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-between">
                        <span className={`text-sm font-semibold ${weightsValid ? 'text-emerald-600' : 'text-red-500'}`}>Total: {weightsTotal.toFixed(1)}/9.0 {!weightsValid && '(must equal 9.0)'}</span>
                        <div className="flex gap-2">
                            <button onClick={resetWeights} className="px-4 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">Reset</button>
                            <button onClick={applyWeights} disabled={!weightsValid} className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">Apply</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Score cards */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-5 flex items-center gap-2"><BarChart3 className="w-4 h-4" />Tiered M&A Assessment Scores</h3>
                    <div className="space-y-6">
                        {METRIC_TIERS.map((tier, tIdx) => {
                            const tierAvg = getTierAverage(targetName, tier.metrics);
                            const tierGatingFailed = tIdx === 0 && tierAvg <= 3;

                            return (
                                <div key={tier.name} className="space-y-3">
                                    <div className="flex items-center justify-between border-b border-gray-50 pb-2">
                                        <div>
                                            <h4 className="text-xs font-bold text-gray-900">{tier.name}</h4>
                                            <p className="text-[10px] text-gray-400 font-medium">{tier.description}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {tierGatingFailed && (
                                                <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[9px] font-bold rounded uppercase">Gating Failed</span>
                                            )}
                                            <div className="text-sm font-extrabold" style={{ color: scoreColor(tierAvg) }}>
                                                Avg: {tierAvg.toFixed(1)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-2.5 pl-2">
                                        {tier.metrics.map(criterion => {
                                            const score = getScore(targetName, criterion);
                                            const w = weights[criterion] ?? 0;
                                            return (
                                                <div key={criterion} className="flex items-center gap-4">
                                                    <div className="w-48 text-[12px] font-medium text-gray-600 shrink-0">{criterion}</div>
                                                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                        <div className={`h-full rounded-full bg-gradient-to-r ${scoreGradient(score)} transition-all duration-700 ease-out`} style={{ width: animated ? `${(score / 5) * 100}%` : '0%' }} />
                                                    </div>
                                                    <div className="w-6 text-right text-[12px] font-bold" style={{ color: scoreColor(score) }}>{score}</div>
                                                    <div className="w-10 text-right text-[9px] text-gray-400 font-medium">w:{w.toFixed(1)}</div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center text-center relative overflow-hidden">
                    {isFlagged && <div className="absolute top-0 left-0 w-full h-1 bg-red-500" />}
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2"><Trophy className="w-4 h-4" />Weighted Overall Score</h3>
                    <div className="relative mb-3">
                        <span className="text-6xl font-extrabold" style={{ color: isFlagged ? '#ef4444' : scoreColor(targetOverall) }}>{targetOverall.toFixed(1)}</span>
                        <span className="text-2xl font-medium text-gray-300 ml-1">/5</span>
                    </div>
                    <div className={`text-sm font-bold uppercase tracking-wider mb-3 ${isFlagged ? 'text-red-600' : verdictColor(targetVerdict)}`}>{targetVerdict}</div>
                    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-4">
                        <div className={`h-full rounded-full bg-gradient-to-r ${isFlagged ? 'from-red-600 to-red-400' : scoreGradient(targetOverall)} transition-all duration-700 ease-out`} style={{ width: animated ? `${(targetOverall / 5) * 100}%` : '0%' }} />
                    </div>
                    {isFlagged && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-left">
                            <ShieldAlert className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-red-700 font-medium leading-relaxed">
                                <strong>Gating Criterion Failed:</strong> Tier 1 (Strategic Fit) average must be greater than 3. This target is flagged as not worth progressing.
                            </p>
                        </div>
                    )}
                    <p className="text-xs text-gray-500 leading-relaxed">{targetSummary}</p>
                </div>
            </div>

            {/* Radar Chart */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2"><Target className="w-4 h-4" />{hasPeers ? `${targetName} vs. Peer Average` : `${targetName} Scores`}</h3>
                <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                            <PolarGrid stroke="#e5e7eb" />
                            <PolarAngleAxis dataKey="criterion" tick={{ fontSize: 11, fill: '#6b7280', fontWeight: 500 }} />
                            <PolarRadiusAxis angle={90} domain={[0, 5]} tick={{ fontSize: 10, fill: '#9ca3af' }} tickCount={6} />
                            <Radar name={targetName} dataKey={targetName} stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} animationDuration={800} animationEasing="ease-out" />
                            {hasPeers && <Radar name="Peer Average" dataKey="Peer Average" stroke="#9ca3af" fill="#9ca3af" fillOpacity={0.08} strokeWidth={1.5} strokeDasharray="4 4" animationDuration={1000} animationEasing="ease-out" animationBegin={200} />}
                            <Legend wrapperStyle={{ fontSize: 12, fontWeight: 600 }} iconType="square" />
                            <Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        </RadarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Comparison Table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div className="p-5 border-b border-gray-50">
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] flex items-center gap-2"><BarChart3 className="w-4 h-4" />{hasPeers ? 'Scores Across All Peers' : 'Criterion Scores'}</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50 border-b border-gray-100">
                                <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider sticky left-0 bg-gray-50/50 z-10">Criterion</th>
                                {companyNames.map((name, i) => (
                                    <th key={name} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-center whitespace-nowrap" style={{ color: COMPANY_COLORS[i % COMPANY_COLORS.length] }}>
                                        {name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {METRIC_TIERS.map((tier) => {
                                const isExpanded = expandedTiers[tier.name];
                                return (
                                    <React.Fragment key={tier.name}>
                                        <tr className="bg-gray-100/50 cursor-pointer hover:bg-gray-200/50 transition-colors" onClick={() => toggleTier(tier.name)}>
                                            <td className="px-4 py-2.5 text-[11px] font-bold text-gray-600 uppercase tracking-wider sticky left-0 bg-inherit z-10 flex items-center gap-2">
                                                <Settings2 className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                                {tier.name}
                                            </td>
                                            {companyNames.map(name => {
                                                const tierAvg = getTierAverage(name, tier.metrics);
                                                return (
                                                    <td key={name} className="px-4 py-2.5 text-center">
                                                        <span className="text-xs font-extrabold" style={{ color: scoreColor(tierAvg) }}>{tierAvg.toFixed(1)}</span>
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                        {isExpanded && tier.metrics.map((criterion) => (
                                            <tr key={criterion} className="hover:bg-gray-50/50 transition-colors group/row relative">
                                                <td className="px-5 py-3 text-[13px] font-medium text-gray-700 sticky left-0 bg-white z-10 whitespace-nowrap pl-8">{criterion}</td>
                                                {companyNames.map(name => {
                                                    const score = getScore(name, criterion);
                                                    const detail = getScoreDetail(name, criterion);
                                                    return (
                                                        <td key={name} className="px-4 py-3 text-center relative group">
                                                            <span className="inline-flex items-center justify-center w-10 h-7 rounded-md text-xs font-bold text-white relative z-10" style={{ backgroundColor: scoreColor(score) }}>{score}</span>
                                                            {detail && (detail.justification || detail.sub_scores) && (
                                                                <div className={`absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-max max-w-sm bg-white border border-slate-200 text-slate-900 text-[12px] rounded-lg p-3 shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[100]`}>
                                                                    {detail.justification && <p className="mb-2 font-medium text-slate-600 leading-relaxed text-left">{detail.justification}</p>}
                                                                    {detail.sub_scores?.map((ss, j) => (
                                                                        <div key={j} className="flex justify-between items-center text-slate-500 mt-1">
                                                                            <span className="font-semibold text-[11px]">{ss.metric}</span>
                                                                            <span className="font-bold text-slate-900 text-[11px]">{typeof ss.value === 'number' ? ss.value.toLocaleString() : ss.value}{ss.score !== undefined && ` → ${ss.score}/5`}</span>
                                                                        </div>
                                                                    ))}
                                                                    <div className={`absolute top-full -mt-[5px] rotate-45 left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white border-b border-r border-slate-200`} />
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                            <tr className="bg-gray-50/70 border-t-2 border-gray-200">
                                <td className="px-4 py-3 text-[13px] font-bold text-gray-900 sticky left-0 bg-gray-50/70 z-10">Weighted Overall Score</td>
                                {companyNames.map(name => {
                                    const overall = computeWeightedScore(name);
                                    const tier1Avg = getTierAverage(name, METRIC_TIERS[0].metrics);
                                    const failedGating = name === targetName && tier1Avg <= 3;
                                    return (
                                        <td key={name} className="px-4 py-3 text-center">
                                            <div className="flex flex-col items-center">
                                                <span className="text-base font-extrabold" style={{ color: failedGating ? '#ef4444' : scoreColor(overall) }}>{overall.toFixed(1)}</span>
                                                {failedGating && <span className="text-[8px] font-bold text-red-500 uppercase">Flagged</span>}
                                            </div>
                                        </td>
                                    );
                                })}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            {/* Profitability Chart */}
            <ProfitabilityChart companies={companies} targetName={targetName} />

            {/* Financial Comparison KPIs */}
            {(() => {
                if (loadingComp) {
                    return (
                        <div className="flex justify-center items-center py-10 bg-white rounded-2xl border border-gray-100 shadow-sm">
                            <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
                        </div>
                    );
                }

                if (!compData || compData.companies.length === 0) return null;

                const comparisonCompanies = compData.companies.filter(c => companyNames.includes(c.company_name));

                if (comparisonCompanies.length === 0) return null;

                // Build conversion rates map
                const rateMap: Record<string, number> = {};
                for (const c of compData.companies) {
                    const key = `${c.currency}_${c.year}`;
                    rateMap[key] = c.usd_rate || 1;
                }

                const toUSD = (val: number | undefined, currency: string, year: number): number | null => {
                    if (val === undefined || val === null) return null;
                    const rate = rateMap[`${currency}_${year}`] || 1;
                    return val * rate;
                };

                return (
                    <div className="space-y-6 mt-8">
                        <div className="flex items-center gap-2 px-1">
                            <DollarSign size={20} className="text-teal-600" />
                            <h2 className="text-lg font-bold text-gray-900">Financial Comparison</h2>
                        </div>

                        {/* Balance Sheet KPIs */}
                    <KPITable
                        title="Balance Sheet KPIs"
                        companies={comparisonCompanies}
                        toUSD={toUSD}
                        columns={[
                            { key: 'total_assets', label: 'Total Assets (MUSD)', type: 'money' },
                            { key: 'total_equity', label: 'Total Equity (MUSD)', type: 'money' },
                            { key: 'total_liabilities', label: 'Total Liabilities (MUSD)', type: 'money' },
                            { key: 'roa_percent', label: 'ROA %', type: 'ratio' },
                            { key: 'roe_percent', label: 'ROE %', type: 'ratio' },
                            { key: 'deposits_to_assets_percent', label: 'Deposits-to-Assets %', type: 'ratio' },
                        ]}
                    />

                    {/* Profitability KPIs */}
                    <KPITable
                        title="Profitability KPIs"
                        companies={comparisonCompanies}
                        toUSD={toUSD}
                        columns={[
                            { key: 'total_operating_revenue', label: 'Total Operating Income (MUSD)', type: 'money' },
                            { key: 'pat', label: 'Net Income (MUSD)', type: 'money' },
                            { key: 'net_interests', label: 'Net Interest Income (MUSD)', type: 'money' },
                            { key: 'nim_percent', label: 'Net Interest Margin %', type: 'ratio' },
                            { key: 'interest_coverage_ratio', label: 'Interest Coverage Ratio', type: 'ratio' },
                            { key: 'cost_to_income_ratio_percent', label: 'Cost-to-Income %', type: 'ratio', isGoodLow: true },
                        ]}
                    />

                    {/* Loan KPIs */}
                    <KPITable
                        title="Loan KPIs"
                        companies={comparisonCompanies}
                        toUSD={toUSD}
                        columns={[
                            { key: 'loan_to_deposit_percent', label: 'LDR %', type: 'ratio' },
                            { key: 'loans_to_assets_percent', label: 'LAR %', type: 'ratio' },
                            { key: 'npl_percent', label: 'NPL Ratio %', type: 'ratio', isGoodLow: true },
                        ]}
                    />

                    {/* Risk KPIs */}
                    <KPITable
                        title="Risk KPIs"
                        companies={comparisonCompanies}
                        toUSD={toUSD}
                        columns={[
                            { key: 'capital_adequacy_percent', label: 'CAR %', type: 'ratio' },
                            { key: 'equity_to_glp_percent', label: 'LCR %', type: 'ratio' },
                            { key: 'provision_coverage_percent', label: 'PCR %', type: 'ratio' },
                        ]}
                    />
                    </div>
                );
            })()}
        </div>
    );
}


/* ── KPI Comparison Table Component ── */

interface KPIColumn {
    key: string;
    label: string;
    type: 'money' | 'ratio';
    isGoodLow?: boolean;
}

function KPITable({ title, companies, toUSD, columns }: {
    title: string;
    companies: any[];
    toUSD: (val: number | undefined, currency: string, year: number) => number | null;
    columns: KPIColumn[];
}) {
    return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-teal-700">
                <h3 className="text-sm font-bold text-white">{title}</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-teal-50 border-b border-teal-100">
                            <th className="text-left px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Entity</th>
                            {columns.map(col => (
                                <th key={col.key} className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider whitespace-nowrap">{col.label}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {companies.map((c, i) => (
                            <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                                <td className="px-4 py-3 text-gray-900 font-semibold text-[13px] whitespace-nowrap">{c.company_name}</td>
                                {columns.map(col => {
                                    let val: number | null = null;
                                    if (col.type === 'money') {
                                        val = toUSD(c.metrics?.[col.key], c.currency, c.year);
                                    } else {
                                        val = c.computed_ratios?.[col.key] ?? c.metrics?.[col.key] ?? null;
                                    }

                                    const cellBg = col.type === 'ratio' && val !== null
                                        ? (col.isGoodLow
                                            ? (val <= 50 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')
                                            : (val >= 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'))
                                        : '';

                                    return (
                                        <td key={col.key} className={`px-4 py-3 text-right tabular-nums font-semibold ${cellBg}`}>
                                            {val !== null
                                                ? col.type === 'money'
                                                    ? fmtUSD(val / 1_000_000)
                                                    : `${val.toFixed(2)}%`
                                                : <span className="text-gray-300">N/A</span>
                                            }
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}


/* ── Peer Selector Component ── */

function PeerSelector({ availableCompanies, selectedPeers, peerDropdownOpen, setPeerDropdownOpen, addPeer, removePeer }: {
    availableCompanies: AnalysisListItem[];
    selectedPeers: string[];
    peerDropdownOpen: boolean;
    setPeerDropdownOpen: (v: boolean) => void;
    addPeer: (name: string) => void;
    removePeer: (name: string) => void;
}) {
    const unselected = availableCompanies.filter(c => !selectedPeers.includes(c.company_name));
    return (
        <div className="flex flex-wrap items-center gap-2">
            {selectedPeers.map(name => (
                <span key={name} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold border border-blue-100">
                    {name}
                    <button onClick={() => removePeer(name)} className="hover:text-blue-900 transition-colors"><X className="w-3 h-3" /></button>
                </span>
            ))}
            {unselected.length > 0 && (
                <div className="relative">
                    <button onClick={() => setPeerDropdownOpen(!peerDropdownOpen)} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-semibold transition-colors">
                        <UserPlus className="w-3 h-3" />Add Peer
                    </button>
                    {peerDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-30 max-h-48 overflow-y-auto">
                            {unselected.map(c => (
                                <button key={c.company_name} onClick={() => addPeer(c.company_name)} className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors first:rounded-t-xl last:rounded-b-xl">
                                    {c.company_name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
            {availableCompanies.length === 0 && selectedPeers.length === 0 && (
                <span className="text-[11px] text-gray-400 italic">No other analyzed companies available as peers</span>
            )}
        </div>
    );
}


/* ── Profitability Chart ── */

function ProfitabilityChart({ companies, targetName }: { companies: any[]; targetName: string }) {
    const chartData = companies.map((c, i) => ({
        name: c.company_name === targetName ? `★ ${c.company_name}` : c.company_name,
        'PAT (USDm)': c.pat ?? 0,
        'ROE (%)': c.roe ?? 0,
        fill: COMPANY_COLORS[i % COMPANY_COLORS.length],
    }));

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4">Profitability Comparison</h3>
            <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 30, bottom: 40, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} interval={0} angle={-20} textAnchor="end" height={60} />
                        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} label={{ value: 'USDm', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9ca3af' } }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} label={{ value: '%', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9ca3af' } }} />
                        <Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Legend wrapperStyle={{ fontSize: 11, fontWeight: 500, paddingTop: 8 }} />
                        <Bar yAxisId="left" dataKey="PAT (USDm)" radius={[4, 4, 0, 0]} barSize={32} animationDuration={800} animationEasing="ease-out">
                            {chartData.map((entry, i) => <Cell key={i} fill={entry.fill} fillOpacity={0.8} />)}
                        </Bar>
                        <Line yAxisId="right" type="monotone" dataKey="ROE (%)" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} animationDuration={1000} animationEasing="ease-out" animationBegin={300} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
