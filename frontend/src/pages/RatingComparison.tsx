import { useState, useEffect } from 'react';
import {
    Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
    Line, ComposedChart, Legend, Cell, Bar,
} from 'recharts';
import { ShieldAlert, Play, Loader2, Trophy, Target, BarChart3, Settings2, UserPlus, X } from 'lucide-react';
import { runPeerRating, fetchPeerRating, fetchAnalyses } from '../api';
import type { AnalysisData, PeerRatingResult, CriterionScore, AnalysisListItem } from '../types';

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
    'Profitability',
    'Scale',
    'Geo Fit',
    'Product Fit',
    'Execution',
    'Management',
    'Partners',
    'IT & Data',
    'Competitor',
];

const COMPANY_COLORS = [
    '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
    '#06b6d4', '#ef4444', '#6366f1', '#14b8a6', '#f97316',
];

/* Default equal weights (sum to 100) */
const DEFAULT_WEIGHTS: { [key: string]: number } = {};
CRITERIA_ORDER.forEach(c => { DEFAULT_WEIGHTS[c] = Math.round(100 / CRITERIA_ORDER.length); });
const totalDefault = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
DEFAULT_WEIGHTS[CRITERIA_ORDER[CRITERIA_ORDER.length - 1]] += 100 - totalDefault;

interface Props {
    data: AnalysisData;
}

export default function RatingComparison({ data }: Props) {
    const [peerData, setPeerData] = useState<PeerRatingResult | null>(null);
    const [loading, setLoading] = useState(false);      // explicit re-run spinner
    const [initializing, setInitializing] = useState(true); // silent first-load
    const [visible, setVisible] = useState(false);          // drives fade-in
    const [animated, setAnimated] = useState(false);        // drives bar/chart animations
    const [error, setError] = useState('');
    const [loaded, setLoaded] = useState(false);
    const [weights, setWeights] = useState<{ [key: string]: number }>({ ...DEFAULT_WEIGHTS });
    const [editingWeights, setEditingWeights] = useState(false);
    const [draftWeights, setDraftWeights] = useState<{ [key: string]: number }>({ ...DEFAULT_WEIGHTS });

    // Peer selection state
    const [availableCompanies, setAvailableCompanies] = useState<AnalysisListItem[]>([]);
    const [selectedPeers, setSelectedPeers] = useState<string[]>([]);
    const [peerDropdownOpen, setPeerDropdownOpen] = useState(false);

    // Load list of analyzed companies for peer selection
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
        // Silent background fetch — does NOT trigger the full-page spinner
        setError('');
        try {
            const result = await fetchPeerRating(data.company_name);
            setPeerData(result);
            // Restore selected peers from cached data
            if (result?.companies) {
                const peerNames = result.companies
                    .map(c => c.company_name)
                    .filter(n => n !== data.company_name);
                setSelectedPeers(peerNames);
            }
            setLoaded(true);
        } catch {
            setLoaded(true);
        } finally {
            setInitializing(false);
            // Small delay so the fade-in animation is visible
            requestAnimationFrame(() => {
                setVisible(true);
                setTimeout(() => setAnimated(true), 50);
            });
        }
    };

    // Try loading cached data on first render
    useEffect(() => {
        if (!loaded) {
            handleLoad();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addPeer = async (name: string) => {
        if (!selectedPeers.includes(name)) {
            setSelectedPeers(prev => [...prev, name]);
            setPeerDropdownOpen(false);

            // Instantly fetch and merge peer's database score
            try {
                const peerResult = await fetchPeerRating(name);
                if (peerResult && peerResult.companies?.length > 0) {
                    setPeerData((prev: any) => {
                        if (!prev) return prev;
                        const newCompanies = [...prev.companies];
                        if (!newCompanies.find((c: any) => c.company_name === name)) {
                            newCompanies.push(peerResult.companies[0]);
                        }
                        return {
                            ...prev,
                            companies: newCompanies,
                            scores: { ...prev.scores, ...peerResult.scores },
                            overall_scores: { ...prev.overall_scores, ...peerResult.overall_scores },
                            summaries: { ...prev.summaries, ...peerResult.summaries }
                        };
                    });
                }
            } catch (err) {
                console.error("Failed to auto-fetch peer rating for", name, err);
                setSelectedPeers(prev => prev.filter(n => n !== name)); // rollback
            }
        }
    };

    const removePeer = (name: string) => {
        setSelectedPeers(prev => prev.filter(n => n !== name));

        setPeerData((prev: any) => {
            if (!prev) return prev;

            const newCompanies = prev.companies.filter((c: any) => c.company_name !== name);
            const newScores = { ...prev.scores };
            delete newScores[name];

            const newOverallScores = { ...prev.overall_scores };
            delete newOverallScores[name];

            const newSummaries = { ...prev.summaries };
            delete newSummaries[name];

            return {
                ...prev,
                companies: newCompanies,
                scores: newScores,
                overall_scores: newOverallScores,
                summaries: newSummaries
            };
        });
    };

    /* ── Weight helpers ── */
    const weightsTotal = Object.values(draftWeights).reduce((a, b) => a + b, 0);
    const weightsValid = weightsTotal === 100;

    const applyWeights = () => {
        setWeights({ ...draftWeights });
        setEditingWeights(false);
    };

    const resetWeights = () => {
        setDraftWeights({ ...DEFAULT_WEIGHTS });
        setWeights({ ...DEFAULT_WEIGHTS });
        setEditingWeights(false);
    };

    const computeWeightedScore = (company: string): number => {
        const cScores = peerData?.scores[company] ?? [];
        let totalWeighted = 0;
        let totalWeight = 0;
        for (const criterion of CRITERIA_ORDER) {
            const w = weights[criterion] ?? 0;
            const s = cScores.find(sc => sc.criterion === criterion)?.score ?? 0;
            totalWeighted += s * w;
            totalWeight += w;
        }
        return totalWeight > 0 ? totalWeighted / totalWeight : 0;
    };

    /* ── Empty state (no cached rating found after silent load) ── */
    if (!initializing && !peerData && !loading) {
        return (
            <div className="animate-in fade-in duration-500">
                {error && (
                    <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-xl text-sm border border-red-100">{error}</div>
                )}
                <div className="flex flex-col items-center justify-center min-h-[400px] text-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/50 p-8">
                    <ShieldAlert className="w-12 h-12 text-gray-300 mb-4" />
                    <h2 className="text-xl font-bold text-gray-900 mb-2">M&A Rating Not Available</h2>
                    <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
                        Run the rating to score {data.company_name} on {CRITERIA_ORDER.length} M&A attractiveness criteria.
                        You can optionally add peer companies for comparison.
                    </p>

                    {/* Peer selection before first run */}
                    <PeerSelector
                        availableCompanies={availableCompanies}
                        selectedPeers={selectedPeers}
                        peerDropdownOpen={peerDropdownOpen}
                        setPeerDropdownOpen={setPeerDropdownOpen}
                        addPeer={addPeer}
                        removePeer={removePeer}
                    />

                    <button
                        onClick={() => handleRun()}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 mt-4"
                    >
                        <Play className="w-4 h-4" />
                        Run Rating{selectedPeers.length > 0 ? ` (+ ${selectedPeers.length} peers)` : ''}
                    </button>
                </div>
            </div>
        );
    }

    /* ── Full-page loading (only when explicitly running a rating) ── */
    if (loading) {
        return (
            <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center min-h-[400px] text-center p-8">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
                <h2 className="text-lg font-bold text-gray-900 mb-2">Scoring…</h2>
                <p className="text-gray-500 text-sm max-w-sm">
                    Computing M&A attractiveness scores. This may take 1–2 minutes.
                </p>
            </div>
        );
    }

    /* ── Still initializing silently — return null (no flash) ── */
    if (initializing || !peerData) return null;

    /* ── Data prep ── */
    const targetName = peerData.target_company;
    const targetOverall = computeWeightedScore(targetName);
    const targetVerdict = verdictFromScore(targetOverall);
    const targetSummary = peerData.summaries[targetName] ?? '';
    const companies = peerData.companies ?? [];
    const companyNames = companies.map(c => c.company_name);
    const hasPeers = companyNames.length > 1;

    const getScore = (company: string, criterion: string): number => {
        const cScores = peerData.scores[company] ?? [];
        return cScores.find(s => s.criterion === criterion)?.score ?? 0;
    };

    const getScoreDetail = (company: string, criterion: string): CriterionScore | undefined => {
        return (peerData.scores[company] ?? []).find(s => s.criterion === criterion);
    };

    // Radar data: target vs peer average
    const radarData = CRITERIA_ORDER.map((c, i) => {
        const targetScore = getScore(targetName, c);
        const entry: any = {
            criterion: CRITERIA_SHORT[i],
            [targetName]: targetScore,
        };
        if (hasPeers) {
            const peerScores = companyNames
                .filter(n => n !== targetName)
                .map(n => getScore(n, c));
            entry['Peer Average'] = peerScores.length > 0
                ? Math.round((peerScores.reduce((a, b) => a + b, 0) / peerScores.length) * 10) / 10
                : 0;
        }
        return entry;
    });

    return (
        <div className={`space-y-8 transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'}`}>
            {/* ── Action bar ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Peer selection */}
                <PeerSelector
                    availableCompanies={availableCompanies}
                    selectedPeers={selectedPeers}
                    peerDropdownOpen={peerDropdownOpen}
                    setPeerDropdownOpen={setPeerDropdownOpen}
                    addPeer={addPeer}
                    removePeer={removePeer}
                />

                <div className="flex gap-3">
                    <button
                        onClick={() => { setDraftWeights({ ...weights }); setEditingWeights(!editingWeights); }}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-semibold text-gray-600 transition-colors"
                    >
                        <Settings2 className="w-3 h-3" />
                        {editingWeights ? 'Cancel Weights' : 'Edit Weights'}
                    </button>
                </div>
            </div>

            {/* ── Weights Editor ── */}
            {editingWeights && (
                <div className="bg-white rounded-2xl border border-blue-100 shadow-sm p-6">
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
                        <Settings2 className="w-4 h-4" />
                        Criteria Weights (must sum to 100)
                    </h3>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                        {CRITERIA_ORDER.map(criterion => (
                            <div key={criterion} className="flex flex-col gap-1">
                                <label className="text-[11px] font-medium text-gray-600 truncate" title={criterion}>
                                    {criterion}
                                </label>
                                <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={draftWeights[criterion] ?? 0}
                                    onChange={e => setDraftWeights(prev => ({ ...prev, [criterion]: parseInt(e.target.value) || 0 }))}
                                    className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
                                />
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-between">
                        <span className={`text-sm font-semibold ${weightsValid ? 'text-emerald-600' : 'text-red-500'}`}>
                            Total: {weightsTotal}/100 {!weightsValid && '(must equal 100)'}
                        </span>
                        <div className="flex gap-2">
                            <button onClick={resetWeights} className="px-4 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                                Reset
                            </button>
                            <button onClick={applyWeights} disabled={!weightsValid} className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50">
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Score cards row ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left: Composite Score Card */}
                <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-5 flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" />
                        Composite M&A Attractiveness Score
                    </h3>
                    <div className="space-y-4">
                        {CRITERIA_ORDER.map((criterion) => {
                            const score = getScore(targetName, criterion);
                            const w = weights[criterion] ?? 0;
                            return (
                                <div key={criterion} className="flex items-center gap-4">
                                    <div className="w-52 text-sm font-medium text-gray-700 shrink-0">{criterion}</div>
                                    <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full bg-gradient-to-r ${scoreGradient(score)} transition-all duration-700 ease-out`}
                                            style={{ width: animated ? `${(score / 5) * 100}%` : '0%' }}
                                        />
                                    </div>
                                    <div className="w-8 text-right text-sm font-bold" style={{ color: scoreColor(score) }}>
                                        {score}
                                    </div>
                                    <div className="w-12 text-right text-[10px] text-gray-400 font-medium">
                                        w:{w}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Right: Overall Score Card */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center text-center">
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
                        <Trophy className="w-4 h-4" />
                        Weighted Score
                    </h3>
                    <div className="relative mb-3">
                        <span className="text-6xl font-extrabold" style={{ color: scoreColor(targetOverall) }}>
                            {targetOverall.toFixed(1)}
                        </span>
                        <span className="text-2xl font-medium text-gray-300 ml-1">/5</span>
                    </div>
                    <div className={`text-sm font-bold uppercase tracking-wider mb-3 ${verdictColor(targetVerdict)}`}>
                        {targetVerdict}
                    </div>
                    <div className="w-full h-2.5 bg-gray-100 rounded-full overflow-hidden mb-4">
                        <div
                            className={`h-full rounded-full bg-gradient-to-r ${scoreGradient(targetOverall)} transition-all duration-700 ease-out`}
                            style={{ width: animated ? `${(targetOverall / 5) * 100}%` : '0%' }}
                        />
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{targetSummary}</p>
                </div>
            </div>

            {/* ── Radar Chart ── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4 flex items-center gap-2">
                    <Target className="w-4 h-4" />
                    {hasPeers ? `${targetName} vs. Peer Average` : `${targetName} Scores`}
                </h3>
                <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                            <PolarGrid stroke="#e5e7eb" />
                            <PolarAngleAxis
                                dataKey="criterion"
                                tick={{ fontSize: 11, fill: '#6b7280', fontWeight: 500 }}
                            />
                            <PolarRadiusAxis
                                angle={90}
                                domain={[0, 5]}
                                tick={{ fontSize: 10, fill: '#9ca3af' }}
                                tickCount={6}
                            />
                            <Radar
                                name={targetName}
                                dataKey={targetName}
                                stroke="#3b82f6"
                                fill="#3b82f6"
                                fillOpacity={0.15}
                                strokeWidth={2}
                                animationDuration={800}
                                animationEasing="ease-out"
                            />
                            {hasPeers && (
                                <Radar
                                    name="Peer Average"
                                    dataKey="Peer Average"
                                    stroke="#9ca3af"
                                    fill="#9ca3af"
                                    fillOpacity={0.08}
                                    strokeWidth={1.5}
                                    strokeDasharray="4 4"
                                    animationDuration={1000}
                                    animationEasing="ease-out"
                                    animationBegin={200}
                                />
                            )}
                            <Legend
                                wrapperStyle={{ fontSize: 12, fontWeight: 600 }}
                                iconType="square"
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a', fontSize: '12px', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#0f172a', fontWeight: 500, padding: 0 }}
                                labelStyle={{ fontWeight: 600, color: '#64748b', marginBottom: '4px' }}
                            />
                        </RadarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* ── Comparison Table ── */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
                <div className="p-5 border-b border-gray-50">
                    <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" />
                        {hasPeers ? 'Scores Across All Peers' : 'Criterion Scores'}
                    </h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50/50 border-b border-gray-100">
                                <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider sticky left-0 bg-gray-50/50 z-10">
                                    Criterion
                                </th>
                                {companyNames.map((name, i) => (
                                    <th key={name} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-center whitespace-nowrap"
                                        style={{ color: COMPANY_COLORS[i % COMPANY_COLORS.length] }}
                                    >
                                        {name === targetName ? `★ ${name}` : name}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {CRITERIA_ORDER.map((criterion, rowIdx) => (
                                <tr key={criterion} className="hover:bg-gray-50/50 transition-colors group/row hover:z-[60] relative">
                                    <td className="px-4 py-3 text-[13px] font-medium text-gray-700 sticky left-0 bg-white z-10 whitespace-nowrap">
                                        {criterion}
                                    </td>
                                    {companyNames.map((name) => {
                                        const detail = getScoreDetail(name, criterion);
                                        const score = detail?.score ?? 0;
                                        // First row: tooltip appears below badge to avoid thead clipping
                                        const isFirstRow = rowIdx === 0;
                                        return (
                                            <td key={name} className="px-4 py-3 text-center relative group hover:z-[60]">
                                                <span
                                                    className="inline-flex items-center justify-center w-10 h-7 rounded-md text-xs font-bold text-white relative z-10"
                                                    style={{ backgroundColor: scoreColor(score) }}
                                                >
                                                    {score}
                                                </span>
                                                {detail && (detail.justification || detail.sub_scores) && (
                                                    <div className={`absolute ${isFirstRow ? 'top-full mt-2' : 'bottom-full mb-2'} left-1/2 -translate-x-1/2 w-max max-w-sm bg-white border border-slate-200 text-slate-900 text-[12px] rounded-lg p-3 shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-[100]`}>
                                                        {detail.justification && <p className="mb-2 font-medium text-slate-600 leading-relaxed text-left">{detail.justification}</p>}
                                                        {detail.sub_scores?.map((ss, j) => (
                                                            <div key={j} className="flex justify-between items-center text-slate-500 mt-1">
                                                                <span className="font-semibold text-[11px]">{ss.metric}</span>
                                                                <span className="font-bold text-slate-900 text-[11px]">
                                                                    {typeof ss.value === 'number' ? ss.value.toLocaleString() : ss.value}
                                                                    {ss.score !== undefined && ` → ${ss.score}/5`}
                                                                </span>
                                                            </div>
                                                        ))}
                                                        {/* Arrow */}
                                                        <div className={`absolute ${isFirstRow ? 'bottom-full -mb-[5px] rotate-[225deg]' : 'top-full -mt-[5px] rotate-45'} left-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white border-b border-r border-slate-200`} />
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                            <tr className="bg-gray-50/70 border-t-2 border-gray-200">
                                <td className="px-4 py-3 text-[13px] font-bold text-gray-900 sticky left-0 bg-gray-50/70 z-10">
                                    Weighted Score
                                </td>
                                {companyNames.map((name) => {
                                    const overall = computeWeightedScore(name);
                                    return (
                                        <td key={name} className="px-4 py-3 text-center">
                                            <span className="text-base font-extrabold" style={{ color: scoreColor(overall) }}>
                                                {overall.toFixed(1)}
                                            </span>
                                        </td>
                                    );
                                })}
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Profitability Chart ── */}
            <ProfitabilityChart companies={companies} targetName={targetName} />
        </div>
    );
}


/* ── Peer Selector Component ── */

function PeerSelector({
    availableCompanies,
    selectedPeers,
    peerDropdownOpen,
    setPeerDropdownOpen,
    addPeer,
    removePeer,
}: {
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
            {/* Selected peer tags */}
            {selectedPeers.map(name => (
                <span key={name} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold border border-blue-100">
                    {name}
                    <button onClick={() => removePeer(name)} className="hover:text-blue-900 transition-colors">
                        <X className="w-3 h-3" />
                    </button>
                </span>
            ))}

            {/* Add peer dropdown */}
            {unselected.length > 0 && (
                <div className="relative">
                    <button
                        onClick={() => setPeerDropdownOpen(!peerDropdownOpen)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-xs font-semibold transition-colors"
                    >
                        <UserPlus className="w-3 h-3" />
                        Add Peer
                    </button>
                    {peerDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-30 max-h-48 overflow-y-auto">
                            {unselected.map(c => (
                                <button
                                    key={c.company_name}
                                    onClick={() => addPeer(c.company_name)}
                                    className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors first:rounded-t-xl last:rounded-b-xl"
                                >
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

function ProfitabilityChart({
    companies, targetName
}: {
    companies: any[];
    targetName: string;
}) {
    const chartData = companies.map((c, i) => ({
        name: c.company_name === targetName ? `★ ${c.company_name}` : c.company_name,
        'PAT (USDm)': c.pat ?? 0,
        'ROE (%)': c.roe ?? 0,
        fill: COMPANY_COLORS[i % COMPANY_COLORS.length],
    }));

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] mb-4">
                Profitability Comparison
            </h3>
            <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 30, bottom: 40, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6b7280' }} interval={0} angle={-20} textAnchor="end" height={60} />
                        <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                            label={{ value: 'USDm', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9ca3af' } }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false}
                            label={{ value: '%', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9ca3af' } }} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a', fontSize: '12px', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                            itemStyle={{ color: '#0f172a', fontWeight: 500, padding: 0 }}
                            labelStyle={{ fontWeight: 600, color: '#64748b', marginBottom: '4px' }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11, fontWeight: 500, paddingTop: 8 }} />
                        <Bar yAxisId="left" dataKey="PAT (USDm)" radius={[4, 4, 0, 0]} barSize={32}
                            animationDuration={800} animationEasing="ease-out">
                            {chartData.map((entry, i) => (
                                <Cell key={i} fill={entry.fill} fillOpacity={0.8} />
                            ))}
                        </Bar>
                        <Line yAxisId="right" type="monotone" dataKey="ROE (%)" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }}
                            animationDuration={1000} animationEasing="ease-out" animationBegin={300} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
