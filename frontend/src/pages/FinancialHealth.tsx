import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Briefcase, ShieldAlert, CreditCard } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SourceBadge } from './BusinessOverview';
import MetricCard from '../components/MetricCard';
import { computeRatios } from '../utils/computeRatios';
import type { AnalysisData, FinancialLineItem, FinancialStatement } from '../types';

/* ── Colour palette for donut charts ── */
const PIE_COLORS = ['#0d9488', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#22c55e', '#ec4899', '#6366f1', '#14b8a6', '#f97316'];

interface Props {
    data: AnalysisData;
    onEditClick?: (statementId: number) => void;
}

/* ── Number formatters ── */
function fmtCompact(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'N/A';
    const abs = Math.abs(v);
    if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toFixed(2);
}

/* ── YoY change badge ── */
function pctBadge(val: number | null | undefined) {
    if (val === null || val === undefined) return <span className="text-gray-300 text-xs">—</span>;
    const isUp = val >= 0;
    return (
        <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
            {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(val).toFixed(1)}%
        </span>
    );
}

/* ── Custom donut label renderer ── */
const renderPieLabel = ({ cx, cy, midAngle, outerRadius, pct }: any) => {
    if (pct < 3) return null; // Hide labels for tiny slices
    const RADIAN = Math.PI / 180;
    const radius = outerRadius + 18;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
        <text x={x} y={y} fill="#374151" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={11} fontWeight={600}>
            {pct.toFixed(1)}%
        </text>
    );
};


export default function FinancialHealth({ data, onEditClick }: Props) {
    const stmts = data.financial_statements || [];
    const years = useMemo(() => stmts.map((s: FinancialStatement) => s.year).sort((a, b) => a - b), [stmts]);
    const latestYear = years[years.length - 1] || 0;
    const prevYear = years.length > 1 ? years[years.length - 2] : null;

    const stmt = useMemo(() => stmts.find((s: FinancialStatement) => s.year === latestYear), [stmts, latestYear]);
    const prevStmt = useMemo(() => prevYear ? stmts.find((s: FinancialStatement) => s.year === prevYear) : undefined, [stmts, prevYear]);

    /* Compute ratios client-side from raw metrics */
    const r = useMemo(() => {
        if (!stmt) return {};
        return computeRatios(stmt.metrics || {}, prevStmt?.metrics || null);
    }, [stmt, prevStmt]);

    const prevR = useMemo(() => {
        if (!prevStmt) return {};
        return computeRatios(prevStmt.metrics || {}, null);
    }, [prevStmt]);

    if (!stmt) {
        return <div className="text-center py-20 text-gray-400">No financial statement data available.</div>;
    }

    const m = stmt.metrics || {};

    /* ── Source lookup helpers ── */
    const metricSourceMap = useMemo(() => {
        const map: Record<string, string> = {};
        for (const md of stmt.metrics_detail || []) {
            map[md.metric_name] = md.data_source;
        }
        return map;
    }, [stmt]);

    const getLineItemsSource = (items: FinancialLineItem[]): string => {
        if (items.length === 0) return 'Files Upload';
        const counts: Record<string, number> = {};
        for (const item of items) {
            const src = item.data_source || 'Files Upload';
            counts[src] = (counts[src] || 0) + 1;
        }
        return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    };

    const metricBadge = (metricName: string) => {
        const source = metricSourceMap[metricName] || 'Files Upload';
        return <SourceBadge source={source} />;
    };

    const ratioBadge = (...inputMetrics: string[]) => {
        for (const name of inputMetrics) {
            const src = metricSourceMap[name];
            if (src) return <SourceBadge source={src} />;
        }
        return <SourceBadge source="Files Upload" />;
    };

    const yoyChange = (key: string, isRatio = false) => {
        const cur = isRatio ? r[key] : m[key];
        const prev = isRatio ? prevR[key] : (prevStmt?.metrics?.[key]);
        if (cur != null && prev != null && prev !== 0) return ((cur - prev) / Math.abs(prev)) * 100;
        return undefined;
    };

    const getChartData = (key: string, isRatio = false) => {
        return years.map((y: number) => {
            const s = stmts.find((st: FinancialStatement) => st.year === y);
            if (isRatio) {
                const prevS = stmts.find((st: FinancialStatement) => st.year === y - 1);
                const yearRatios = computeRatios(s?.metrics || {}, prevS?.metrics || null);
                return { name: y, val: yearRatios[key] || 0 };
            }
            const val = s?.metrics?.[key];
            return { name: y, val: val || 0 };
        });
    };

    const assets = stmt.line_items.filter((i: FinancialLineItem) => i.category === 'Asset');
    const liabilities = stmt.line_items.filter((i: FinancialLineItem) => i.category === 'Liability');
    const equities = stmt.line_items.filter((i: FinancialLineItem) => i.category === 'Equity');
    const incomeItems = stmt.line_items.filter((i: FinancialLineItem) => i.category === 'Income');

    /* Equity / GLP ratio — safe computation */
    const equityGlpDisplay = (() => {
        if (m.total_equity != null && m.gross_loan_portfolio != null && m.gross_loan_portfolio !== 0) {
            return `${((m.total_equity / m.gross_loan_portfolio) * 100).toFixed(1)}%`;
        }
        return 'N/A';
    })();

    return (
        <div className="space-y-8">
            {/* ── Top Controls ── */}
            <div className="flex items-center justify-end gap-3 mb-6">
                {onEditClick && (
                    <button
                        onClick={() => onEditClick(stmt.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        Edit Metrics
                    </button>
                )}
            </div>

            {/* ── Balance Sheet Health ── */}
            <section>
                <SectionHeader icon={<Briefcase size={16} />} title="Balance Sheet Health" color="blue" />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <MetricCard title="Total Assets" value={m.total_assets} delta={yoyChange('total_assets')} chartData={getChartData('total_assets')} badge={metricBadge('total_assets')} />
                    <MetricCard title="Total Liabilities" value={m.total_liabilities} delta={yoyChange('total_liabilities')} chartData={getChartData('total_liabilities')} isNegativeGood badge={metricBadge('total_liabilities')} />
                    <MetricCard title="Total Equity" value={m.total_equity} delta={yoyChange('total_equity')} chartData={getChartData('total_equity')} badge={metricBadge('total_equity')} />
                    <MetricCard title="ROA" value={r.roa_percent} delta={yoyChange('roa_percent', true)} isRatio badge={ratioBadge('pat', 'total_assets')} />
                    <MetricCard title="ROE" value={r.roe_percent} delta={yoyChange('roe_percent', true)} isRatio badge={ratioBadge('pat', 'total_equity')} />
                    <MetricCard title="Deposits to Asset" value={r.deposits_to_assets_percent} delta={yoyChange('deposits_to_assets_percent', true)} isRatio badge={ratioBadge('debts_to_clients', 'total_assets')} />
                </div>
            </section>

            {/* ── Balance Sheet: Assets ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                    <LineItemTable 
                        title="Asset Line Items" 
                        items={assets} 
                        prevItems={prevStmt?.line_items.filter((i: FinancialLineItem) => i.category === 'Asset') || []}
                        sizeLabel="Asset Size %" 
                        source={getLineItemsSource(assets)} 
                        denominator={m.total_assets || 0} 
                    />
                </div>
                <div className="lg:col-span-2">
                    <CommonSizePie title="Assets Common-Size Analysis" items={assets} source={getLineItemsSource(assets)} denominator={m.total_assets || 0} />
                </div>
            </div>

            {/* ── Balance Sheet: Liabilities ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                    <LineItemTable 
                        title="Liabilities Line Items" 
                        items={liabilities} 
                        prevItems={prevStmt?.line_items.filter((i: FinancialLineItem) => i.category === 'Liability') || []}
                        sizeLabel="Liability Size %" 
                        source={getLineItemsSource(liabilities)} 
                        denominator={(m.total_liabilities || 0) + (m.total_equity || 0)} 
                    />
                </div>
                <div className="lg:col-span-2">
                    <CommonSizePie title="Liabilities Common-Size Analysis" items={liabilities} source={getLineItemsSource(liabilities)} denominator={(m.total_liabilities || 0) + (m.total_equity || 0)} />
                </div>
            </div>

            {/* ── Balance Sheet: Equity ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                    <LineItemTable 
                        title="Equity Line Items" 
                        items={equities} 
                        prevItems={prevStmt?.line_items.filter((i: FinancialLineItem) => i.category === 'Equity') || []}
                        sizeLabel="Equity Size %" 
                        source={getLineItemsSource(equities)} 
                        denominator={(m.total_liabilities || 0) + (m.total_equity || 0)} 
                    />
                </div>
                <div className="lg:col-span-2">
                    <CommonSizePie title="Equity Common-Size Analysis" items={equities} source={getLineItemsSource(equities)} denominator={(m.total_liabilities || 0) + (m.total_equity || 0)} />
                </div>
            </div>

            {/* ── Profitability & Risk ── */}
            <section>
                <SectionHeader icon={<TrendingUp size={16} />} title="Profitability & Risk" color="emerald" />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <MetricCard title="Op. Income" value={m.total_operating_revenue} delta={yoyChange('total_operating_revenue')} chartData={getChartData('total_operating_revenue')} badge={metricBadge('total_operating_revenue')} />
                    <MetricCard title="Net Interest Inc." value={m.net_interests} delta={yoyChange('net_interests')} chartData={getChartData('net_interests')} badge={metricBadge('net_interests')} />
                    <MetricCard 
                        title="Net Income" 
                        value={m.pat} 
                        delta={yoyChange('pat')} 
                        chartData={getChartData('pat')} 
                        badge={metricBadge('pat')} 
                        tooltip="Covers overall performance including any discontinued operations"
                    />
                    <MetricCard title="Net Int. Margin" value={r.nim_percent} delta={yoyChange('nim_percent', true)} isRatio badge={ratioBadge('net_interests', 'total_assets')} />
                    <MetricCard title="Int. Coverage" value={r.interest_coverage_ratio} delta={yoyChange('interest_coverage_ratio', true)} isRatio suffix="x" badge={ratioBadge('ebitda', 'net_interests')} />
                    <MetricCard title="Cost to Income" value={r.cost_to_income_ratio_percent} delta={yoyChange('cost_to_income_ratio_percent', true)} isRatio isNegativeGood badge={ratioBadge('total_operating_revenue', 'pat')} />
                </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                    <IncomeTable 
                        items={incomeItems} 
                        prevItems={prevStmt?.line_items.filter((i: FinancialLineItem) => i.category === 'Income') || []}
                        source={getLineItemsSource(incomeItems)} 
                        denominator={m.total_operating_revenue || 0} 
                    />
                </div>
                <div className="lg:col-span-2">
                    <div className="space-y-3">
                        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-2">Key Ratios</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <MetricCard title="Loan-to-Deposit" value={r.loan_to_deposit_percent} delta={yoyChange('loan_to_deposit_percent', true)} isRatio badge={ratioBadge('gross_loan_portfolio', 'debts_to_clients')} />
                            <MetricCard title="Loan-to-Asset" value={r.loans_to_assets_percent} delta={yoyChange('loans_to_assets_percent', true)} isRatio badge={ratioBadge('gross_loan_portfolio', 'total_assets')} />
                            <MetricCard title="Capital Adequacy" value={r.capital_adequacy_percent} delta={yoyChange('capital_adequacy_percent', true)} isRatio badge={ratioBadge('total_equity', 'total_assets')} />
                            <MetricCard title="Non-Performing Loan" value={r.npl_percent} delta={yoyChange('npl_percent', true)} isRatio isNegativeGood badge={ratioBadge('gross_non_performing_loans', 'gross_loan_portfolio')} />
                            <MetricCard title="Provision Coverage" value={r.provision_coverage_percent} delta={yoyChange('provision_coverage_percent', true)} isRatio badge={ratioBadge('total_loan_loss_provisions', 'gross_non_performing_loans')} />
                            <MetricCard title="PAR >30 %" value={r.par_30_percent} delta={yoyChange('par_30_percent', true)} isRatio isNegativeGood badge={ratioBadge('loans_with_arrears_over_30_days', 'gross_loan_portfolio')} />
                            <MetricCard title="Liquidity Coverage" value={r.equity_to_glp_percent} delta={yoyChange('equity_to_glp_percent', true)} isRatio badge={ratioBadge('total_equity', 'gross_loan_portfolio')} />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Loan Book ── */}
            <section>
                <SectionHeader icon={<CreditCard size={16} />} title="Loan Book" color="violet" />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    <MetricCard title="Gross Loan Portfolio" value={m.gross_loan_portfolio} delta={yoyChange('gross_loan_portfolio')} chartData={getChartData('gross_loan_portfolio')} badge={metricBadge('gross_loan_portfolio')} />
                    <MetricCard title="Credit Rating" value={m.credit_rating || 'N/A'} hideChart badge={metricBadge('credit_rating')} />
                    <MetricCard
                        title="Deposits / Borrowings"
                        value={m.debts_to_clients != null && m.debts_to_financial_institutions != null
                            ? `${fmtCompact(m.debts_to_clients)} / ${fmtCompact(m.debts_to_financial_institutions)}`
                            : 'N/A'}
                        hideChart
                        badge={ratioBadge('debts_to_clients', 'debts_to_financial_institutions')}
                    />
                    <MetricCard title="Disbursals" value={m.disbursals} delta={yoyChange('disbursals')} chartData={getChartData('disbursals')} badge={metricBadge('disbursals')} />
                    <MetricCard title="Equity / GLP" value={equityGlpDisplay} hideChart badge={ratioBadge('total_equity', 'gross_loan_portfolio')} />
                </div>
            </section>

            {/* ── Risks & Anomalies ── */}
            {data.anomalies_and_risks && data.anomalies_and_risks.length > 0 && (
                <section>
                    <SectionHeader icon={<ShieldAlert size={16} />} title="Risks & Anomalies" color="rose" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {data.anomalies_and_risks.map((risk: any, i: number) => (
                            <div key={i} className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                                <div className="flex items-start justify-between mb-2">
                                    <h4 className="font-semibold text-gray-900">{risk.category}</h4>
                                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                        risk.severity_level === 'High' ? 'bg-red-100 text-red-700' :
                                        risk.severity_level === 'Medium' ? 'bg-amber-100 text-amber-700' :
                                        'bg-emerald-100 text-emerald-700'
                                    }`}>{risk.severity_level}</span>
                                </div>
                                <p className="text-sm text-gray-600 mb-3 leading-relaxed">{risk.description}</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                    <div className="bg-gray-50 rounded-lg p-3">
                                        <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Valuation Impact</span>
                                        <p className="mt-1 text-gray-700">{risk.valuation_impact}</p>
                                    </div>
                                    <div className="bg-gray-50 rounded-lg p-3">
                                        <span className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Negotiation Leverage</span>
                                        <p className="mt-1 text-gray-700">{risk.negotiation_leverage}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ══════════════════════════════════════════════════════════════════ */

function SectionHeader({ icon, title, color }: { icon: React.ReactNode; title: string; color: string }) {
    const colorMap: Record<string, string> = {
        blue: 'bg-blue-100 text-blue-600',
        violet: 'bg-violet-100 text-violet-600',
        emerald: 'bg-emerald-100 text-emerald-600',
        cyan: 'bg-cyan-100 text-cyan-600',
        orange: 'bg-orange-100 text-orange-600',
        rose: 'bg-rose-100 text-rose-600',
        teal: 'bg-teal-100 text-teal-600',
    };
    return (
        <div className="flex items-center gap-2.5 mb-5">
            <div className={`w-7 h-7 rounded-lg ${colorMap[color] ?? colorMap.blue} flex items-center justify-center`}>{icon}</div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        </div>
    );
}


function LineItemTable({ title, items, prevItems, sizeLabel, source, denominator }: { title: string; items: FinancialLineItem[]; prevItems: FinancialLineItem[]; sizeLabel: string; source: string; denominator: number }) {
    const nonTotal = items.filter(i => !i.is_total);
    const totalRow = items.find(i => i.is_total);

    // Find corresponding total in prevItems
    const prevTotalRow = prevItems.find(i => i.is_total);

    return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-teal-700 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">{title}</h3>
                <SourceBadge source={source} />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-teal-50/60 border-b border-teal-100">
                            <th className="text-left px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Line Item</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Value</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">{sizeLabel}</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">YoY Change</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Abs. Change</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {nonTotal.map((item, idx) => {
                            const pct = denominator !== 0 ? ((item.value_reported || 0) / denominator) * 100 : 0;
                            // Find matching item in prevYear
                            const prevItem = prevItems.find(p => p.item_name === item.item_name);
                            const absChange = (item.value_reported || 0) - (prevItem?.value_reported || 0);
                            const chgPct = (prevItem?.value_reported && prevItem.value_reported !== 0) 
                                ? (absChange / Math.abs(prevItem.value_reported)) * 100 
                                : undefined;

                            return (
                                <tr key={item.id || idx} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-4 py-2.5 text-gray-700 font-medium text-[13px]">{item.item_name}</td>
                                    <td className="px-4 py-2.5 text-right text-gray-900 font-semibold tabular-nums">{fmtCompact(item.value_reported)}</td>
                                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{denominator !== 0 ? `${pct.toFixed(1)}%` : <span className="text-gray-300">—</span>}</td>
                                    <td className="px-4 py-2.5 text-right">{pctBadge(chgPct)}</td>
                                    <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums text-xs">{prevItem ? fmtCompact(absChange) : ''}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {totalRow && (
                        <tfoot>
                            <tr className="bg-teal-50 border-t-2 border-teal-200 font-bold">
                                <td className="px-4 py-2.5 text-teal-800">Total</td>
                                <td className="px-4 py-2.5 text-right text-teal-900 tabular-nums">{fmtCompact(totalRow.value_reported)}</td>
                                <td className="px-4 py-2.5 text-right text-teal-700">{denominator !== 0 ? '100.0%' : ''}</td>
                                <td className="px-4 py-2.5 text-right">
                                    {(() => {
                                        const absChange = (totalRow.value_reported || 0) - (prevTotalRow?.value_reported || 0);
                                        const chgPct = (prevTotalRow?.value_reported && prevTotalRow.value_reported !== 0) 
                                            ? (absChange / Math.abs(prevTotalRow.value_reported)) * 100 
                                            : undefined;
                                        return pctBadge(chgPct);
                                    })()}
                                </td>
                                <td className="px-4 py-2.5 text-right text-teal-900 tabular-nums">
                                    {prevTotalRow ? fmtCompact((totalRow.value_reported || 0) - (prevTotalRow.value_reported || 0)) : ''}
                                </td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}


function IncomeTable({ items, prevItems, source, denominator }: { items: FinancialLineItem[]; prevItems: FinancialLineItem[]; source: string; denominator: number }) {
    const nonTotal = items.filter(i => !i.is_total);
    const totalRow = items.find(i => i.is_total);
    const prevTotalRow = prevItems.find(i => i.is_total);

    return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-teal-700 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">Income Statement</h3>
                <SourceBadge source={source} />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-teal-50/60 border-b border-teal-100">
                            <th className="text-left px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Line Item</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Value</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Size %</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">YoY Change</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Abs. Change</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {nonTotal.map((item, idx) => {
                            const pct = denominator !== 0 ? ((item.value_reported || 0) / denominator) * 100 : 0;
                            const prevItem = prevItems.find(p => p.item_name === item.item_name);
                            const absChange = (item.value_reported || 0) - (prevItem?.value_reported || 0);
                            const chgPct = (prevItem?.value_reported && prevItem.value_reported !== 0) 
                                ? (absChange / Math.abs(prevItem.value_reported)) * 100 
                                : undefined;

                            return (
                                <tr key={item.id || idx} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-4 py-2.5 text-gray-700 font-medium text-[13px]">{item.item_name}</td>
                                    <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${(item.value_reported || 0) < 0 ? 'text-red-500' : 'text-gray-900'}`}>{fmtCompact(item.value_reported)}</td>
                                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{denominator !== 0 ? `${pct.toFixed(1)}%` : <span className="text-gray-300">—</span>}</td>
                                    <td className="px-4 py-2.5 text-right">{pctBadge(chgPct)}</td>
                                    <td className="px-4 py-2.5 text-right text-gray-400 tabular-nums text-xs">{prevItem ? fmtCompact(absChange) : ''}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {totalRow && (
                        <tfoot>
                            <tr className="bg-teal-50 border-t-2 border-teal-200 font-bold">
                                <td className="px-4 py-2.5 text-teal-800">{totalRow.item_name}</td>
                                <td className="px-4 py-2.5 text-right text-teal-900 tabular-nums">{fmtCompact(totalRow.value_reported)}</td>
                                <td className="px-4 py-2.5 text-right text-teal-700">{denominator !== 0 ? '100.0%' : ''}</td>
                                <td className="px-4 py-2.5 text-right">
                                    {(() => {
                                        const absChange = (totalRow.value_reported || 0) - (prevTotalRow?.value_reported || 0);
                                        const chgPct = (prevTotalRow?.value_reported && prevTotalRow.value_reported !== 0) 
                                            ? (absChange / Math.abs(prevTotalRow.value_reported)) * 100 
                                            : undefined;
                                        return pctBadge(chgPct);
                                    })()}
                                </td>
                                <td className="px-4 py-2.5 text-right text-teal-900 tabular-nums">
                                    {prevTotalRow ? fmtCompact((totalRow.value_reported || 0) - (prevTotalRow.value_reported || 0)) : ''}
                                </td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}


function CommonSizePie({ title, items, source, denominator }: { title: string; items: FinancialLineItem[]; source: string; denominator: number }) {
    const pieData = items
        .filter((i: FinancialLineItem) => !i.is_total && i.value_reported && i.value_reported > 0)
        .map((i: FinancialLineItem) => {
            const pct = denominator !== 0 ? ((i.value_reported || 0) / denominator) * 100 : 0;
            return {
                name: i.item_name,
                value: i.value_reported || 0,
                pct,
            };
        });

    if (pieData.length === 0) return null;

    return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col h-full">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700">{title}</h3>
                <SourceBadge source={source} />
            </div>
            <div className="flex-1 min-h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={pieData}
                            cx="50%"
                            cy="42%"
                            outerRadius={85}
                            innerRadius={38}
                            dataKey="value"
                            nameKey="name"
                            paddingAngle={2}
                            label={renderPieLabel}
                            labelLine={{ stroke: '#d1d5db', strokeWidth: 1 }}
                        >
                            {pieData.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(v: any, name: any) => [`${fmtCompact(Number(v))} (${pieData.find(d => d.name === name)?.pct.toFixed(1)}%)`, String(name)]}
                            contentStyle={{ borderRadius: '10px', border: '1px solid #e5e7eb', fontSize: '11px', padding: '6px 10px', boxShadow: '0 4px 12px -2px rgb(0 0 0 / 0.08)' }}
                        />
                        <Legend
                            verticalAlign="bottom"
                            iconType="circle"
                            iconSize={7}
                            wrapperStyle={{ fontSize: '10px', paddingTop: '8px', lineHeight: '18px' }}
                            formatter={(value: string) => <span className="text-gray-600">{value.length > 22 ? `${value.slice(0, 22)}...` : value}</span>}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
