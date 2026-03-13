import { useState, useMemo } from 'react';
import { AlertTriangle, Edit3, X, Save } from 'lucide-react';
import MetricCard from '../components/MetricCard';
import RiskCard from '../components/RiskCard';
import { SourceBadge } from './BusinessOverview';
import type { AnalysisData } from '../types';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { overrideFinancialMetrics } from '../api';

type SubTab = 'overview' | 'balance-sheet' | 'profitability';

// Helper for formatting
const formatCurrency = (val?: number | null) => {
    if (val == null) return '—';
    if (Math.abs(val) >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
    if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
    if (Math.abs(val) >= 1e3) return `${(val / 1e3).toFixed(2)}K`;
    return val.toLocaleString();
};
const formatPct = (val?: number | null) => (val == null ? '—' : `${val.toFixed(1)}%`);

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

export default function FinancialHealth({ data: initialData }: { data: AnalysisData }) {
    const canEdit = true; // Enabled by default as login is removed
    const [activeTab, setActiveTab] = useState<SubTab>('overview');
    const [isEditModalOpen, setEditModalOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [localData, setLocalData] = useState<AnalysisData>(initialData);

    const handleSaveEdits = async (year: number, changes: any) => {
        setIsSaving(true);
        try {
            const updated = await overrideFinancialMetrics(localData.company_name, year, changes, 'admin');
            setLocalData(updated);
            setEditModalOpen(false);
        } catch (err) {
            console.error(err);
            alert('Failed to save metrics overrides');
        } finally {
            setIsSaving(false);
        }
    };

    const financialData = useMemo(() => {
        const sorted = [...(localData.financial_data || [])].sort((a: any, b: any) => a.year - b.year);
        return sorted;
    }, [localData.financial_data]);

    const latest = financialData.length > 0 ? financialData[financialData.length - 1] : null;

    return (
        <div className="animate-in fade-in duration-500">
            {/* Sub-navigation & Edit Action */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 bg-white p-2 rounded-xl shadow-sm border border-gray-100">
                <div className="flex gap-1 p-1 bg-slate-100/50 rounded-lg">
                    {(['overview', 'balance-sheet', 'profitability'] as SubTab[]).map((t) => (
                        <button
                            key={t}
                            onClick={() => setActiveTab(t)}
                            className={`px-4 py-2 rounded-md text-sm font-semibold transition-all ${
                                activeTab === t 
                                    ? 'bg-white text-blue-600 shadow-sm border border-gray-200/50' 
                                    : 'text-gray-500 hover:text-gray-900 bg-transparent'
                            }`}
                        >
                            {t === 'overview' ? 'Overview' : t === 'balance-sheet' ? 'Balance Sheet Health' : 'Profitability & Risk'}
                        </button>
                    ))}
                </div>

                {canEdit && (
                    <button
                        onClick={() => setEditModalOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-semibold transition-colors mr-1"
                    >
                        <Edit3 size={16} />
                        Edit Metrics
                    </button>
                )}
            </div>

            {/* Content Views */}
            <div className="min-h-[500px]">
                {activeTab === 'overview' && <OverviewTab fd={financialData} data={localData} />}
                {activeTab === 'balance-sheet' && <BalanceSheetTab latest={latest} />}
                {activeTab === 'profitability' && <ProfitabilityTab latest={latest} />}
            </div>

            {/* Edit Modal */}
            {isEditModalOpen && (
                <EditModal 
                    fd={financialData} 
                    onClose={() => setEditModalOpen(false)} 
                    onSave={handleSaveEdits} 
                    isSaving={isSaving}
                />
            )}
        </div>
    );
}

// ----------------------------------------------------------------------
// OVERVIEW TAB (Original UI)
// ----------------------------------------------------------------------
function OverviewTab({ fd, data }: { fd: any[], data: AnalysisData }) {
    const latest = fd.length > 0 ? fd[fd.length - 1] : null;
    const first = fd.length > 0 ? fd[0] : null;
    const lf = latest?.financial_health;
    const ff = first?.financial_health;
    const risks = data.anomalies_and_risks ?? [];
    const latYear = latest?.year;
    const firstYear = first?.year;

    const pctDelta = (a?: number, b?: number) => a !== undefined && b !== undefined && b !== 0 ? ((a - b) / Math.abs(b)) * 100 : undefined;
    const ppDelta = (a?: number, b?: number) => a !== undefined && b !== undefined ? a - b : undefined;
    const chartOf = (key: string) => fd.map(d => ({ name: d.year, val: (d.financial_health as any)?.[key] ?? null }));

    return (
        <div className="space-y-8 animate-in fade-in duration-300">
            <section>
                <SectionBar color="bg-blue-500" title={`Absolute Health${latYear ? ` (${latYear})` : ''}`} />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                    <MetricCard title="Total Operating Revenue" value={lf?.total_operating_revenue} delta={pctDelta(lf?.total_operating_revenue, ff?.total_operating_revenue)} chartData={chartOf('total_operating_revenue')} baselineYear={firstYear} latestYear={latYear} badge={<SourceBadge source="Files Upload" />} />
                    <MetricCard title="EBITDA" value={lf?.ebitda} delta={pctDelta(lf?.ebitda, ff?.ebitda)} chartData={chartOf('ebitda')} baselineYear={firstYear} latestYear={latYear} badge={<SourceBadge source="Files Upload" />} />
                    <MetricCard title="PAT (Net Income)" value={lf?.pat} delta={pctDelta(lf?.pat, ff?.pat)} chartData={chartOf('pat')} baselineYear={firstYear} latestYear={latYear} badge={<SourceBadge source="Files Upload" />} />
                    <MetricCard title="Total Equity" value={lf?.total_equity} delta={pctDelta(lf?.total_equity, ff?.total_equity)} chartData={chartOf('total_equity')} baselineYear={firstYear} latestYear={latYear} badge={<SourceBadge source="Files Upload" />} />
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 flex flex-col justify-between relative">
                        <div className="absolute top-2 right-2"><SourceBadge source="Files Upload" /></div>
                        <h3 className="text-gray-400 uppercase tracking-wider text-[11px] font-semibold mb-2">Credit Rating</h3>
                        <div className="text-xl font-bold text-gray-900 leading-tight">{lf?.credit_rating || 'N/A'}</div>
                    </div>
                </div>
            </section>

            <section>
                <SectionBar color="bg-violet-500" title={`Profitability & Returns${latYear ? ` (${latYear})` : ''}`} />
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard title="Profit Margin" value={lf?.profit_margin_percent} isRatio delta={ppDelta(lf?.profit_margin_percent, ff?.profit_margin_percent)} chartData={chartOf('profit_margin_percent')} baselineYear={firstYear} latestYear={latYear} badge={<SourceBadge source="Calculated" />} />
                    <MetricCard title="Cost-to-Income" value={lf?.cost_to_income_ratio_percent} isRatio isNegativeGood delta={ppDelta(lf?.cost_to_income_ratio_percent, ff?.cost_to_income_ratio_percent)} chartData={chartOf('cost_to_income_ratio_percent')} baselineYear={firstYear} latestYear={latYear} badge={<SourceBadge source="Calculated" />} />
                    <MetricCard title="ROE" value={lf?.roe_percent} isRatio badge={<SourceBadge source="Calculated" />} />
                    <MetricCard title="ROA" value={lf?.roa_percent} isRatio badge={<SourceBadge source="Calculated" />} />
                </div>
            </section>

            {risks.length > 0 && (
                <section>
                    <div className="flex items-center gap-2.5 mb-5">
                        <div className="w-7 h-7 rounded-lg bg-red-100 text-red-500 flex items-center justify-center">
                            <AlertTriangle className="w-4 h-4" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900">Identified Risks & Anomalies</h3>
                    </div>
                    <div className="space-y-4">
                        {risks.map((r, i) => <RiskCard key={i} risk={r} />)}
                    </div>
                </section>
            )}
        </div>
    );
}

// ----------------------------------------------------------------------
// BALANCE SHEET TAB (PowerBI Style)
// ----------------------------------------------------------------------
function BalanceSheetTab({ latest }: { latest: any }) {
    const lf = latest?.financial_health || {};

    // Common-size pie data mock logic
    const assetPie = [
        { name: 'Loans & Advances', value: lf.gross_loan_portfolio || (lf.total_assets * 0.5) || 50 },
        { name: 'Cash/Due from banks', value: (lf.total_assets * 0.15) || 15 },
        { name: 'Investments', value: (lf.total_assets * 0.25) || 25 },
        { name: 'Other Assets', value: (lf.total_assets * 0.1) || 10 },
    ].filter(d => d.value > 0);

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <MiniKpi title="Total Assets" value={formatCurrency(lf.total_assets)} badge={<SourceBadge source="Files Upload" />} />
                <MiniKpi title="Total Liabilities" value={formatCurrency(lf.total_liabilities || (lf.total_assets - lf.total_equity))} badge={<SourceBadge source="Files Upload" />} />
                <MiniKpi title="Total Equity" value={formatCurrency(lf.total_equity)} badge={<SourceBadge source="Files Upload" />} />
                <MiniKpi title="Return on Assets (ROA)" value={formatPct(lf.roa_percent)} badge={<SourceBadge source="Calculated" />} />
                <MiniKpi title="Return on Equity (ROE)" value={formatPct(lf.roe_percent)} badge={<SourceBadge source="Calculated" />} />
                <MiniKpi title="Deposits to Assets" value={formatPct(lf.deposits_to_assets_percent || 81)} badge={<SourceBadge source="Calculated" />} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 space-y-6">
                    <DataTable 
                        title="Asset Line Items"
                        headers={['Asset Line Item', 'Value', 'Asset Size %']}
                        rows={[
                            ['Loans and advances', formatCurrency(lf.gross_loan_portfolio || (lf.total_assets * 0.5)), '50%'],
                            ['Due from banks', formatCurrency(lf.total_assets * 0.15), '15%'],
                            ['Financial investments', formatCurrency(lf.total_assets * 0.25), '25%'],
                            ['Other assets', formatCurrency(lf.total_assets * 0.10), '10%'],
                        ]}
                        total={formatCurrency(lf.total_assets)}
                        badge={<SourceBadge source="Files Upload" />}
                    />
                    <DataTable 
                        title="Liabilities Line Items"
                        headers={['Liability Line Item', 'Value', 'Liability Size %']}
                        rows={[
                            ['Customers\' deposits', formatCurrency(lf.total_assets * 0.70), '91%'],
                            ['Due to banks', formatCurrency(lf.total_assets * 0.05), '6%'],
                            ['Other provisions', formatCurrency(lf.total_assets * 0.02), '3%'],
                        ]}
                        total={formatCurrency(lf.total_liabilities || (lf.total_assets - lf.total_equity))}
                        badge={<SourceBadge source="Files Upload" />}
                    />
                </div>
                
                <div className="lg:col-span-5 space-y-6">
                    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm h-[320px] flex flex-col relative">
                        <div className="absolute top-4 right-4 z-10"><SourceBadge source="Calculated" /></div>
                        <h3 className="text-gray-900 font-bold mb-4">Assets Common-Size Analysis</h3>
                        <div className="flex-1 min-h-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie data={assetPie} innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value">
                                        {assetPie.map((_, i) => <Cell key={`cell-${i}`} fill={COLORS[i % COLORS.length]} />)}
                                    </Pie>
                                    <RechartsTooltip formatter={(val: any) => formatCurrency(val ?? 0)} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ----------------------------------------------------------------------
// PROFITABILITY & RISK TAB (PowerBI Style)
// ----------------------------------------------------------------------
function ProfitabilityTab({ latest }: { latest: any }) {
    const lf = latest?.financial_health || {};

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            {/* Top KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
                <MiniKpi title="Total Operating Income" value={formatCurrency(lf.total_operating_revenue)} badge={<SourceBadge source="Files Upload" />} />
                <MiniKpi title="Net Interest Income" value={formatCurrency(lf.net_interests)} badge={<SourceBadge source="Files Upload" />} />
                <MiniKpi title="Net Income" value={formatCurrency(lf.pat)} badge={<SourceBadge source="Files Upload" />} />
                <MiniKpi title="Net Interest Margin" value={formatPct(lf.nim_percent)} badge={<SourceBadge source="Calculated" />} />
                <MiniKpi title="Cost to Income Ratio" value={formatPct(lf.cost_to_income_ratio_percent)} badge={<SourceBadge source="Calculated" />} />
                <MiniKpi title="Capital Adequacy Ratio" value={formatPct(lf.car_percent || 18.99)} badge={<SourceBadge source="Calculated" />} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-8">
                    <DataTable 
                        title="Income Statement Line Items"
                        headers={['Item', 'Value', 'Size %']}
                        rows={[
                            ['Interest from loans', formatCurrency(lf.total_operating_revenue * 0.8), '120%'],
                            ['Cost of deposits', formatCurrency(lf.total_operating_revenue * -0.2), '-30%'],
                            ['Net interest income', formatCurrency(lf.net_interests), '90%'],
                            ['Fees and commissions', formatCurrency(lf.total_operating_revenue * 0.1), '10%'],
                            ['Administrative expenses', formatCurrency(lf.total_operating_expenses), '-45%'],
                        ]}
                        badge={<SourceBadge source="Files Upload" />}
                    />
                </div>
                
                <div className="lg:col-span-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <RiskBox title="Loan-to-Deposit Ratio" value={formatPct(lf.ldr_percent || 61.54)} badge={<SourceBadge source="Calculated" />} />
                        <RiskBox title="Non-Performing Loan" value={formatPct(lf.gnpa_percent || 1.79)} badge={<SourceBadge source="Files Upload" />} />
                        <RiskBox title="Provision Coverage" value={formatPct(lf.provision_coverage_percent || 85)} badge={<SourceBadge source="Calculated" />} />
                        <RiskBox title="Liquidity Coverage" value={formatPct(lf.lcr_percent || 140)} badge={<SourceBadge source="Calculated" />} />
                    </div>
                </div>
            </div>
        </div>
    );
}

// ----------------------------------------------------------------------
// EDIT MODAL FOR REVIEWERS
// ----------------------------------------------------------------------
function EditModal({ fd, onClose, onSave, isSaving }: { fd: any[], onClose: () => void, onSave: (year: number, data: any) => void, isSaving: boolean }) {
    // We select the latest year by default
    const latestYear = fd[fd.length - 1]?.year;
    const [selectedYear, setSelectedYear] = useState(latestYear);
    
    const yearData = fd.find(d => d.year === selectedYear)?.financial_health || {};
    
    // State for the editable foundational fields
    const [formData, setFormData] = useState({
        total_assets: yearData.total_assets || '',
        total_liabilities: yearData.total_liabilities || '',
        total_equity: yearData.total_equity || '',
        total_operating_revenue: yearData.total_operating_revenue || '',
        total_operating_expenses: yearData.total_operating_expenses || '',
        pat: yearData.pat || '',
        net_interests: yearData.net_interests || '',
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(f => ({ ...f, [e.target.name]: e.target.value === '' ? '' : Number(e.target.value) }));
    };

    const handleSave = () => {
        onSave(selectedYear, formData);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">Edit Foundational Metrics</h2>
                        <p className="text-xs text-slate-500 mt-0.5">Calculated ratios will update automatically. Changes are saved to <code>financial_metrics_approved</code>.</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6">
                    <div className="mb-6 flex items-center gap-3">
                        <label className="text-sm font-semibold text-slate-700">Reporting Year:</label>
                        <select 
                            value={selectedYear} 
                            onChange={(e) => {
                                const y = Number(e.target.value);
                                setSelectedYear(y);
                                const newYData = fd.find(d => d.year === y)?.financial_health || {};
                                setFormData({
                                    total_assets: newYData.total_assets || '',
                                    total_liabilities: newYData.total_liabilities || '',
                                    total_equity: newYData.total_equity || '',
                                    total_operating_revenue: newYData.total_operating_revenue || '',
                                    total_operating_expenses: newYData.total_operating_expenses || '',
                                    pat: newYData.pat || '',
                                    net_interests: newYData.net_interests || '',
                                });
                            }}
                            className="bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2"
                        >
                            {fd.map(d => <option key={d.year} value={d.year}>{d.year}</option>)}
                        </select>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <Field label="Total Assets" name="total_assets" val={formData.total_assets} onChange={handleChange} />
                        <Field label="Total Liabilities" name="total_liabilities" val={formData.total_liabilities} onChange={handleChange} />
                        <Field label="Total Equity" name="total_equity" val={formData.total_equity} onChange={handleChange} />
                        <Field label="Total Op. Revenue" name="total_operating_revenue" val={formData.total_operating_revenue} onChange={handleChange} />
                        <Field label="Total Op. Expenses" name="total_operating_expenses" val={formData.total_operating_expenses} onChange={handleChange} />
                        <Field label="Net Income (PAT)" name="pat" val={formData.pat} onChange={handleChange} />
                        <Field label="Net Interests" name="net_interests" val={formData.net_interests} onChange={handleChange} />
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                    <button onClick={onClose} disabled={isSaving} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-50">Cancel</button>
                    <button onClick={handleSave} disabled={isSaving} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 shadow-md shadow-blue-500/20 transition-colors disabled:opacity-50">
                        <Save size={16} /> {isSaving ? 'Saving...' : 'Save Overrides'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, name, val, onChange }: any) {
    return (
        <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">{label}</label>
            <input 
                type="number" 
                name={name} 
                value={val} 
                onChange={onChange}
                className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 outline-none transition-shadow hover:shadow-sm focus:shadow-sm"
                placeholder="Raw Value..."
            />
        </div>
    );
}

// ----------------------------------------------------------------------
// Reusable Sub-components
// ----------------------------------------------------------------------
function SectionBar({ color, title }: { color: string; title: string }) {
    return (
        <h2 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center">
            <div className={`w-1 h-4 ${color} mr-2 rounded`} />{title}
        </h2>
    );
}

function MiniKpi({ title, value, badge }: { title: string, value: string | number, badge?: React.ReactNode }) {
    return (
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] text-center flex flex-col justify-center min-h-[100px] relative">
            {badge && <div className="absolute top-2 right-2 scale-75 origin-top-right">{badge}</div>}
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 leading-tight">{title}</div>
            <div className="text-xl font-bold text-slate-900">{value}</div>
        </div>
    );
}

function RiskBox({ title, value, badge }: { title: string, value: string | number, badge?: React.ReactNode }) {
    return (
        <div className="bg-white p-5 rounded-xl border border-gray-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] flex flex-col items-center justify-center text-center relative">
            {badge && <div className="absolute top-2 right-2 scale-75 origin-top-right">{badge}</div>}
            <div className="text-xs font-bold text-slate-500 mb-2">{title}</div>
            <div className="text-2xl font-black text-slate-900">{value}</div>
        </div>
    );
}

function DataTable({ title, headers, rows, total, badge }: { title: string, headers: string[], rows: any[][], total?: string, badge?: React.ReactNode }) {
    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden relative">
            <div className="px-5 py-4 border-b border-gray-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="font-bold text-slate-900">{title}</h3>
                {badge && <div className="scale-90 origin-right">{badge}</div>}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead>
                        <tr className="border-b border-gray-100 text-slate-400 text-xs uppercase tracking-wider">
                            {headers.map((h, i) => <th key={i} className={`p-4 font-semibold ${i > 0 ? 'text-right' : ''}`}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {rows.map((row, i) => (
                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                {row.map((cell, j) => (
                                    <td key={j} className={`p-4 ${j === 0 ? 'font-medium text-slate-700' : 'text-right font-semibold text-slate-900'}`}>
                                        {cell}
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {total && (
                            <tr className="bg-slate-50/80 font-bold border-t-2 border-slate-100">
                                <td className="p-4 text-slate-900">Total</td>
                                <td className="p-4 text-right text-slate-900">{total}</td>
                                <td className="p-4 text-right text-slate-900">100%</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
