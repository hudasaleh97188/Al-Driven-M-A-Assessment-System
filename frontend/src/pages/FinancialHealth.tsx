import { TrendingUp, TrendingDown, AlertTriangle, Info } from 'lucide-react';
import MetricCard from '../components/MetricCard';
import RiskCard from '../components/RiskCard';
import RatioBar from '../components/RatioBar';
import type { AnalysisData } from '../types';

export default function FinancialHealth({ data }: { data: AnalysisData }) {
    // financial_data is pre-sorted oldest→newest by normalise()
    const fd = data.financial_data ?? [];
    const latest = fd.length > 0 ? fd[fd.length - 1] : null;
    const first = fd.length > 0 ? fd[0] : null;
    const lf = latest?.financial_health;
    const ff = first?.financial_health;
    const risks = data.anomalies_and_risks ?? [];
    const latYear = latest?.year;
    const firstYear = first?.year;

    const pctDelta = (a?: number, b?: number) =>
        a !== undefined && b !== undefined && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : undefined;

    const ppDelta = (a?: number, b?: number) =>
        a !== undefined && b !== undefined ? a - b : undefined;

    const chartOf = (key: string) =>
        fd.map(d => ({ name: d.year, val: (d.financial_health as any)?.[key] ?? null }));

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* ──── Absolute Health ──── */}
            <section>
                <SectionBar color="bg-blue-500" title={`Absolute Health${latYear ? ` (${latYear})` : ''}`} />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    <MetricCard title="Total Operating Revenue" value={lf?.total_operating_revenue} delta={pctDelta(lf?.total_operating_revenue, ff?.total_operating_revenue)} chartData={chartOf('total_operating_revenue')} baselineYear={firstYear} latestYear={latYear} />
                    <MetricCard title="EBITDA" value={lf?.ebitda} delta={pctDelta(lf?.ebitda, ff?.ebitda)} chartData={chartOf('ebitda')} baselineYear={firstYear} latestYear={latYear} />
                    <MetricCard
                        title={
                            <span className="flex items-center gap-1.5 relative group cursor-help">
                                PAT (Net Income)
                                <Info size={12} className="text-gray-400 group-hover:text-gray-600 transition-colors" />
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[200px] bg-white border border-slate-200 text-slate-900 text-[11px] font-normal leading-tight rounded-lg p-2.5 shadow-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50 text-center">
                                    overall performance including any discontinued operations
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-white border-b border-r border-slate-200 rotate-45 -mt-[4px]" />
                                </div>
                            </span>
                        }
                        value={lf?.pat} delta={pctDelta(lf?.pat, ff?.pat)} chartData={chartOf('pat')} baselineYear={firstYear} latestYear={latYear} />
                    <MetricCard title="Total Equity" value={lf?.total_equity} delta={pctDelta(lf?.total_equity, ff?.total_equity)} chartData={chartOf('total_equity')} baselineYear={firstYear} latestYear={latYear} />
                    {/* Credit Rating */}
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100/80 hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-gray-400 uppercase tracking-wider text-[11px] font-semibold">Credit Rating</h3>
                            {latYear && <span className="text-[10px] text-gray-300 font-medium">{latYear}</span>}
                        </div>
                        <div className="text-xl font-bold text-gray-900 break-words leading-tight">{lf?.credit_rating || 'N/A'}</div>
                        <div className="flex gap-1.5 mt-4 items-end">
                            {fd.map((d, i) => (
                                <div key={i} className="group relative flex-1">
                                    <div className="h-2 rounded-full bg-gray-200 w-full hover:bg-gray-400 cursor-pointer transition-colors" />
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-900 shadow-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                                        {d.year}: {d.financial_health?.credit_rating || 'N/A'}
                                        <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-white border-b border-r border-slate-200 rotate-45 -mt-[4px]" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* ──── Profitability & Returns ──── */}
            <section>
                <SectionBar color="bg-violet-500" title={`Profitability & Returns${latYear ? ` (${latYear})` : ''}`} />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard title="Profit Margin" value={lf?.profit_margin_percent} isRatio delta={ppDelta(lf?.profit_margin_percent, ff?.profit_margin_percent)} chartData={chartOf('profit_margin_percent')} baselineYear={firstYear} latestYear={latYear} />
                    <MetricCard title="ROE" value={lf?.roe_percent} isRatio delta={ppDelta(lf?.roe_percent, ff?.roe_percent)} chartData={chartOf('roe_percent')} baselineYear={firstYear} latestYear={latYear} />
                    <MetricCard title="ROA" value={lf?.roa_percent} isRatio delta={ppDelta(lf?.roa_percent, ff?.roa_percent)} chartData={chartOf('roa_percent')} baselineYear={firstYear} latestYear={latYear} />
                    <MetricCard title="Cost-to-Income" value={lf?.cost_to_income_ratio_percent} isRatio isNegativeGood delta={ppDelta(lf?.cost_to_income_ratio_percent, ff?.cost_to_income_ratio_percent)} chartData={chartOf('cost_to_income_ratio_percent')} baselineYear={firstYear} latestYear={latYear} />
                </div>
            </section>

            {/* ──── Asset Quality & Loan Book ──── */}
            <section>
                <SectionBar color="bg-teal-500" title={`Asset Quality & Loan Book${latYear ? ` (${latYear})` : ''}`} />
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                    <MetricCard title="Net Interest Margin" value={lf?.nim_percent} isRatio delta={ppDelta(lf?.nim_percent, ff?.nim_percent)} chartData={chartOf('nim_percent')} baselineYear={firstYear} latestYear={latYear} />
                    <MetricCard title="Equity / GLP" value={lf?.equity_to_glp_percent} isRatio delta={ppDelta(lf?.equity_to_glp_percent, ff?.equity_to_glp_percent)} chartData={chartOf('equity_to_glp_percent')} baselineYear={firstYear} latestYear={latYear} />
                    <RatioBar ratio={lf?.depositors_vs_borrowers_ratio ?? 0} />
                </div>

                {/* Loan Book Table */}
                <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 bg-gray-50/50">
                                    <th className="p-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Metric</th>
                                    {fd.map(d => <th key={d.year} className="p-4 text-right text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{d.year}</th>)}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                <LoanRow label="Gross Loan Portfolio" data={fd} field="gross_loan_portfolio" />
                                <LoanRow label="Disbursals" data={fd} field="disbursals" />
                                <LoanRow label="GNPA / NPL >90 Days (%)" data={fd} field="gnpa_percent" isRatio isNegativeGood />
                                <LoanRow label="PAR 30 (%)" data={fd} field="par_30_percent" isRatio isNegativeGood />
                                <LoanRow label="Provision Coverage (%)" data={fd} field="provision_coverage_percent" isRatio />
                                <LoanRow label="Total Assets" data={fd} field="total_assets" />
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* ──── Risks & Anomalies ──── */}
            {risks.length > 0 && (
                <section>
                    <div className="flex items-center gap-2.5 mb-5">
                        <div className="w-7 h-7 rounded-lg bg-red-100 text-red-500 flex items-center justify-center">
                            <AlertTriangle className="w-4 h-4" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">Identified Risks & Anomalies</h3>
                        <span className="text-[10px] font-bold px-2.5 py-0.5 bg-red-100 text-red-600 rounded-full border border-red-200">
                            {risks.length} items
                        </span>
                    </div>
                    <div className="space-y-4">
                        {risks.map((r, i) => <RiskCard key={i} risk={r} />)}
                    </div>
                </section>
            )}
        </div>
    );
}

/* ── Helpers ── */

function SectionBar({ color, title }: { color: string; title: string }) {
    return (
        <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center">
            <div className={`w-1 h-4 ${color} mr-2 rounded`} />{title}
        </h2>
    );
}

function YoYBadge({ current, previous, isRatio = false, isNegativeGood = false }: {
    current?: number | null; previous?: number | null; isRatio?: boolean; isNegativeGood?: boolean;
}) {
    if (current == null || previous == null) return null;
    let diff: number;
    let label: string;
    if (isRatio) {
        diff = current - previous;
        label = `${diff > 0 ? '+' : ''}${diff.toFixed(2)} pp`;
    } else {
        if (previous === 0) return null;
        diff = ((current - previous) / Math.abs(previous)) * 100;
        label = `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`;
    }
    if (Math.abs(diff) < 0.01) return null;
    const isPos = diff > 0;
    const isGood = isNegativeGood ? !isPos : isPos;
    const cls = isGood ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700';
    return (
        <span className={`ml-2 px-1.5 py-0.5 text-[10px] font-semibold rounded-full ${cls} inline-flex items-center`}>
            {isPos ? <TrendingUp size={10} className="mr-0.5" /> : <TrendingDown size={10} className="mr-0.5" />}
            {label}
        </span>
    );
}

function LoanRow({ label, data, field, isRatio = false, isNegativeGood = false }: {
    label: string;
    data: any[];
    field: string;
    isRatio?: boolean;
    isNegativeGood?: boolean;
}) {
    return (
        <tr className="hover:bg-blue-50/30 transition-colors">
            <td className="p-4 text-gray-600 font-medium">{label}</td>
            {data.map((d, i) => {
                const val = d.financial_health?.[field];
                const prev = data[i - 1]?.financial_health?.[field];
                return (
                    <td key={d.year} className="p-4 text-right font-semibold text-gray-900">
                        {val != null ? (isRatio ? `${val}%` : val.toLocaleString()) : '—'}
                        {i > 0 && <YoYBadge current={val} previous={prev} isRatio={isRatio} isNegativeGood={isNegativeGood} />}
                    </td>
                );
            })}
        </tr>
    );
}
