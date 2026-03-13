import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Edit3, Briefcase, ShieldAlert, CreditCard } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { SourceBadge } from './BusinessOverview';
import MetricCard from '../components/MetricCard';
import type { AnalysisData, FinancialLineItem, FinancialStatement } from '../types';

const PIE_COLORS = ['#0d9488', '#0ea5e9', '#f59e0b', '#8b5cf6', '#ef4444', '#22c55e', '#ec4899', '#6366f1'];

interface Props {
    data: AnalysisData;
    onEditClick?: (statementId: number) => void;
}

function fmt(v: number | null | undefined, decimals = 0): string {
    if (v === null || v === undefined) return 'N/A';
    const abs = Math.abs(v);
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toFixed(decimals);
}

function fmtFull(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'N/A';
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function pctBadge(val: number | null | undefined) {
    if (val === null || val === undefined) return null;
    const isUp = val >= 0;
    return (
        <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${isUp ? 'text-emerald-600' : 'text-red-500'}`}>
            {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {Math.abs(val).toFixed(0)}%
        </span>
    );
}

export default function FinancialHealth({ data, onEditClick }: Props) {
    const stmts = data.financial_statements || [];
    const years = useMemo(() => stmts.map((s: FinancialStatement) => s.year).sort((a, b) => a - b), [stmts]);
    const latestYear = years[years.length - 1] || 0;
    const prevYear = years.length > 1 ? years[years.length - 2] : null;

    const stmt = useMemo(() => stmts.find((s: FinancialStatement) => s.year === latestYear), [stmts, latestYear]);
    const prevStmt = useMemo(() => prevYear ? stmts.find((s: FinancialStatement) => s.year === prevYear) : undefined, [stmts, prevYear]);

    if (!stmt) {
        return <div className="text-center py-20 text-gray-400">No financial statement data available.</div>;
    }

    const m = stmt.metrics || {};
    const r = stmt.computed_ratios || {};
    const overallSource = stmt.line_items?.[0]?.data_source || stmt.metrics_detail?.[0]?.data_source || 'Files Upload';

    const yoyChange = (key: string, isRatio = false) => {
        const cur = isRatio ? r[key] : m[key];
        const prev = isRatio ? (prevStmt?.computed_ratios?.[key]) : (prevStmt?.metrics?.[key]);
        if (cur != null && prev != null && prev !== 0) return ((cur - prev) / Math.abs(prev)) * 100;
        return undefined;
    };

    const getChartData = (key: string, isRatio = false) => {
        return years.map((y: number) => {
            const s = stmts.find((st: FinancialStatement) => st.year === y);
            const val = isRatio ? s?.computed_ratios?.[key] : s?.metrics?.[key];
            return { name: y, val: val || 0 };
        });
    };

    const assets = stmt.line_items.filter((i: FinancialLineItem) => i.category === 'Asset');
    const liabilities = stmt.line_items.filter((i: FinancialLineItem) => i.category === 'Liability');
    const equities = stmt.line_items.filter((i: FinancialLineItem) => i.category === 'Equity');
    const incomeItems = stmt.line_items.filter((i: FinancialLineItem) => i.category === 'Income');

    return (
        <div className="space-y-8">
            {/* ── Top Controls ── */}
            <div className="flex items-center justify-end gap-3 mb-6">
                {onEditClick && (
                    <button
                        onClick={() => onEditClick(stmt.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
                    >
                        <Edit3 size={14} />
                        Edit Metrics
                    </button>
                )}
            </div>

            {/* ── Balance Sheet Health ── */}
            <section>
                <div className="flex justify-between items-center mb-5">
                    <SectionHeader icon={<Briefcase size={16} />} title="Balance Sheet Health" color="blue" noMargin />
                    <SourceBadge source={overallSource} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <MetricCard title="Total Assets" value={m.total_assets} delta={yoyChange('total_assets')} chartData={getChartData('total_assets')} />
                    <MetricCard title="Total Liabilities" value={m.total_liabilities} delta={yoyChange('total_liabilities')} chartData={getChartData('total_liabilities')} isNegativeGood />
                    <MetricCard title="Total Equity" value={m.total_equity} delta={yoyChange('total_equity')} chartData={getChartData('total_equity')} />
                    <MetricCard title="ROA" value={r.roa_percent} delta={yoyChange('roa_percent', true)} isRatio />
                    <MetricCard title="ROE" value={r.roe_percent} delta={yoyChange('roe_percent', true)} isRatio />
                    <MetricCard title="Deposits to Asset" value={r.deposits_to_assets_percent} delta={yoyChange('deposits_to_assets_percent', true)} isRatio />
                </div>
            </section>

            {/* ── Balance Sheet: Assets ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                    <LineItemTable
                        title="Asset Line Items"
                        items={assets}
                        sizeLabel="Asset Size %"
                    />
                </div>
                <div className="lg:col-span-2">
                    <CommonSizePie title="Assets Common-Size Analysis" items={assets} />
                </div>
            </div>

            {/* ── Balance Sheet: Liabilities ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                    <LineItemTable
                        title="Liabilities Line Items"
                        items={liabilities}
                        sizeLabel="Liability Size %"
                    />
                </div>
                <div className="lg:col-span-2">
                    <CommonSizePie title="Liabilities Common-Size Analysis" items={liabilities} />
                </div>
            </div>

            {/* ── Balance Sheet: Equity ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                    <LineItemTable
                        title="Equity Line Items"
                        items={equities}
                        sizeLabel="Equity Size %"
                    />
                </div>
                <div className="lg:col-span-2">
                    <CommonSizePie title="Equity Common-Size Analysis" items={equities} />
                </div>
            </div>

            {/* ── Profitability & Risk ── */}
            <section>
                <SectionHeader icon={<TrendingUp size={16} />} title="Profitability & Risk" color="emerald" />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <MetricCard title="Op. Income" value={m.total_operating_revenue} delta={yoyChange('total_operating_revenue')} chartData={getChartData('total_operating_revenue')} />
                    <MetricCard title="Net Interest Inv." value={m.net_interests} delta={yoyChange('net_interests')} chartData={getChartData('net_interests')} />
                    <MetricCard title="Net Income" value={m.pat} delta={yoyChange('pat')} chartData={getChartData('pat')} />
                    <MetricCard title="Net Int. Margin" value={r.nim_percent} delta={yoyChange('nim_percent', true)} isRatio />
                    <MetricCard title="Int. Coverage" value={r.interest_coverage_ratio} delta={yoyChange('interest_coverage_ratio', true)} isRatio suffix="x" />
                    <MetricCard title="Cost to Income" value={r.cost_to_income_ratio_percent} delta={yoyChange('cost_to_income_ratio_percent', true)} isRatio />
                </div>
            </section>

            {/* ── Income Statement + Ratios ── */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3">
                    <IncomeTable items={incomeItems} />
                </div>
                <div className="lg:col-span-2 space-y-3">
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-2">Key Ratios</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <MetricCard title="Loan-to-Deposit" value={r.loan_to_deposit_percent} delta={yoyChange('loan_to_deposit_percent', true)} isRatio />
                        <MetricCard title="Capital Adequacy" value={r.capital_adequacy_percent} delta={yoyChange('capital_adequacy_percent', true)} isRatio />
                        <MetricCard title="Non-Performing Loan" value={r.npl_percent} delta={yoyChange('npl_percent', true)} isRatio />
                        <MetricCard title="Liquidity Coverage" value={r.equity_to_glp_percent} delta={yoyChange('equity_to_glp_percent', true)} isRatio />
                        <MetricCard title="Provision Coverage" value={r.provision_coverage_percent} delta={yoyChange('provision_coverage_percent', true)} isRatio />
                        <MetricCard title="Loans-to-Assets" value={r.loans_to_assets_percent} delta={yoyChange('loans_to_assets_percent', true)} isRatio />
                    </div>
                </div>
            </div>

            {/* ── Loan Book ── */}
            <section>
                <SectionHeader icon={<CreditCard size={16} />} title="Loan Book" color="violet" />
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <MetricCard title="Gross Loan Portfolio" value={m.gross_loan_portfolio} delta={yoyChange('gross_loan_portfolio')} chartData={getChartData('gross_loan_portfolio')} />
                    <MetricCard title="Credit Rating" value={m.credit_rating || 'N/A'} hideChart />
                    <MetricCard title="Deposits / Borrowings" value={m.debts_to_clients != null && m.debts_to_financial_institutions != null ? `${fmt(m.debts_to_clients)} / ${fmt(m.debts_to_financial_institutions)}` : 'N/A'} hideChart />
                    <MetricCard title="PAR 30 (6%)" value={m.loans_with_arrears_over_30_days != null && m.gross_loan_portfolio ? `${((m.loans_with_arrears_over_30_days / m.gross_loan_portfolio) * 100).toFixed(1)}%` : 'N/A'} delta={yoyChange('loans_with_arrears_over_30_days')} chartData={getChartData('loans_with_arrears_over_30_days')} />
                    <MetricCard title="Disbursals" value={m.disbursals} delta={yoyChange('disbursals')} chartData={getChartData('disbursals')} />
                    <MetricCard title="GLP / Equity" value={m.equity_to_glp_percent != null ? `${(100 / m.equity_to_glp_percent * 100).toFixed(1)}%` : (m.gross_loan_portfolio && m.total_equity ? `${(m.gross_loan_portfolio / m.total_equity).toFixed(1)}%` : 'N/A')} isRatio />
                </div>
            </section>

            {/* ── Risks & Anomalies ── */}
            {data.anomalies_and_risks && data.anomalies_and_risks.length > 0 && (
                <div>
                    <SectionHeader icon={<ShieldAlert size={16} />} title="Identified Risks & Anomalies" color="rose" />
                    <div className="space-y-3">
                        {data.anomalies_and_risks.map((risk: any, i: number) => (
                            <div key={i} className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                                <div className="flex items-start justify-between mb-2">
                                    <h4 className="font-semibold text-gray-900">{risk.category}</h4>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                        risk.severity_level === 'High' ? 'bg-red-100 text-red-700' :
                                        risk.severity_level === 'Medium' ? 'bg-amber-100 text-amber-700' :
                                        'bg-green-100 text-green-700'
                                    }`}>{risk.severity_level}</span>
                                </div>
                                <p className="text-sm text-gray-600 mb-3">{risk.description}</p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                    <div className="bg-gray-50 rounded-lg p-3">
                                        <span className="font-semibold text-gray-500 uppercase tracking-wider">Valuation Impact</span>
                                        <p className="mt-1 text-gray-700">{risk.valuation_impact}</p>
                                    </div>
                                    <div className="bg-gray-50 rounded-lg p-3">
                                        <span className="font-semibold text-gray-500 uppercase tracking-wider">Negotiation Leverage</span>
                                        <p className="mt-1 text-gray-700">{risk.negotiation_leverage}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── Sub-components ── */

function SectionHeader({ icon, title, color, noMargin = false }: { icon: React.ReactNode; title: string; color: string, noMargin?: boolean }) {
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
        <div className={`flex items-center gap-2.5 ${noMargin ? '' : 'mb-5'}`}>
            <div className={`w-7 h-7 rounded-lg ${colorMap[color] ?? colorMap.blue} flex items-center justify-center`}>{icon}</div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        </div>
    );
}


function LineItemTable({ title, items, sizeLabel }: { title: string; items: FinancialLineItem[]; sizeLabel: string }) {
    const nonTotal = items.filter(i => !i.is_total);
    const totalRow = items.find(i => i.is_total);

    return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-teal-700">
                <h3 className="text-sm font-bold text-white">{title}</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-teal-50 border-b border-teal-100">
                            <th className="text-left px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">{title.replace(' Line Items', ' Line Item')}</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Value</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">{sizeLabel}</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">% Change</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Absolute Change</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {nonTotal.map(item => (
                            <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                                <td className="px-4 py-2.5 text-gray-700 font-medium text-[13px]">{item.item_name}</td>
                                <td className="px-4 py-2.5 text-right text-gray-900 font-semibold tabular-nums">{fmtFull(item.value_reported)}</td>
                                <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{item.size_percent != null ? `${item.size_percent}%` : ''}</td>
                                <td className="px-4 py-2.5 text-right">{pctBadge(item.change_percent)}</td>
                                <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${(item.absolute_change || 0) < 0 ? 'text-red-500' : 'text-gray-700'}`}>
                                    {fmtFull(item.absolute_change)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {totalRow && (
                        <tfoot>
                            <tr className="bg-teal-50 border-t-2 border-teal-200 font-bold">
                                <td className="px-4 py-2.5 text-teal-800">Total</td>
                                <td className="px-4 py-2.5 text-right text-teal-900 tabular-nums">{fmtFull(totalRow.value_reported)}</td>
                                <td className="px-4 py-2.5 text-right text-teal-700">{totalRow.size_percent != null ? `${totalRow.size_percent}%` : ''}</td>
                                <td className="px-4 py-2.5 text-right">{pctBadge(totalRow.change_percent)}</td>
                                <td className="px-4 py-2.5 text-right text-teal-900 tabular-nums">{fmtFull(totalRow.absolute_change)}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}

function IncomeTable({ items }: { items: FinancialLineItem[] }) {
    const nonTotal = items.filter(i => !i.is_total);
    const totalRow = items.find(i => i.is_total);

    return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-teal-700">
                <h3 className="text-sm font-bold text-white">Income Statement Line Items</h3>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-teal-50 border-b border-teal-100">
                            <th className="text-left px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Income Statement Line Item</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Value</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Size %</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">% Change</th>
                            <th className="text-right px-4 py-2.5 text-[10px] font-bold text-teal-800 uppercase tracking-wider">Absolute Change</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {nonTotal.map(item => (
                            <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                                <td className="px-4 py-2.5 text-gray-700 font-medium text-[13px]">{item.item_name}</td>
                                <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${(item.value_reported || 0) < 0 ? 'text-red-500' : 'text-gray-900'}`}>
                                    {fmtFull(item.value_reported)}
                                </td>
                                <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{item.size_percent != null ? `${item.size_percent}%` : ''}</td>
                                <td className="px-4 py-2.5 text-right">{pctBadge(item.change_percent)}</td>
                                <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${(item.absolute_change || 0) < 0 ? 'text-red-500' : 'text-gray-700'}`}>
                                    {fmtFull(item.absolute_change)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {totalRow && (
                        <tfoot>
                            <tr className="bg-teal-50 border-t-2 border-teal-200 font-bold">
                                <td className="px-4 py-2.5 text-teal-800">{totalRow.item_name}</td>
                                <td className="px-4 py-2.5 text-right text-teal-900 tabular-nums">{fmtFull(totalRow.value_reported)}</td>
                                <td className="px-4 py-2.5 text-right text-teal-700">{totalRow.size_percent != null ? `${totalRow.size_percent}%` : ''}</td>
                                <td className="px-4 py-2.5 text-right">{pctBadge(totalRow.change_percent)}</td>
                                <td className="px-4 py-2.5 text-right text-teal-900 tabular-nums">{fmtFull(totalRow.absolute_change)}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}

function CommonSizePie({ title, items }: { title: string; items: FinancialLineItem[] }) {
    const pieData = items
        .filter((i: FinancialLineItem) => !i.is_total && i.value_reported && i.value_reported > 0)
        .map((i: FinancialLineItem) => ({
            name: i.item_name,
            value: i.value_reported || 0,
            pct: i.size_percent || 0,
        }));

    if (pieData.length === 0) return null;

    return (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col h-full">
            <h3 className="text-sm font-bold text-gray-700 mb-4">{title}</h3>
            <div className="flex-1 min-h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={pieData}
                            cx="50%"
                            cy="45%"
                            outerRadius={90}
                            innerRadius={40}
                            dataKey="value"
                            nameKey="name"
                            paddingAngle={2}
                            label={({ pct }: any) => `${pct.toFixed(1)}%`}
                            labelLine={true}
                        >
                            {pieData.map((_, i) => (
                                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip
                            formatter={(v: any, name: any) => [fmtFull(Number(v)), String(name)]}
                            contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }}
                        />
                        <Legend
                            verticalAlign="bottom"
                            iconType="circle"
                            iconSize={8}
                            wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

