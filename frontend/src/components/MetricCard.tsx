import { TrendingUp, TrendingDown, Info } from 'lucide-react';
import { BarChart, Bar, Cell, Tooltip, ResponsiveContainer, XAxis } from 'recharts';

/* ── Compact number formatter (K / M / B) ── */
function fmtCompact(v: number): string {
    const abs = Math.abs(v);
    if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toFixed(2);
}

interface MetricCardProps {
    title: React.ReactNode | string;
    value?: number | string | null;
    delta?: number;
    isRatio?: boolean;
    isNegativeGood?: boolean;
    chartData?: { name: number | string; val: number | null }[];
    chartKey?: string;
    baselineYear?: number;
    suffix?: string;
    latestYear?: number;
    badge?: React.ReactNode;
    hideChart?: boolean;
    tooltip?: string;
}

export default function MetricCard({
    title, value, delta, isRatio = false, isNegativeGood = false,
    chartData, chartKey = 'val', baselineYear, suffix, badge, hideChart = false,
    tooltip
}: MetricCardProps) {
    const isPositiveDelta = typeof delta === 'number' && delta >= 0;
    const valueSuffix = suffix ?? (isRatio ? '%' : '');
    const deltaSuffix = isRatio ? ' p.p.' : '%';

    let deltaColor = 'text-gray-500';
    if (delta !== undefined) {
        if (isNegativeGood) deltaColor = isPositiveDelta ? 'text-red-500' : 'text-emerald-600';
        else deltaColor = isPositiveDelta ? 'text-emerald-600' : 'text-red-500';
    }

    /* Format the display value */
    const displayValue = (() => {
        if (value === undefined || value === null) return 'N/A';
        if (typeof value === 'string') return `${value}${valueSuffix}`;
        if (isRatio) return `${value.toFixed(2)}${valueSuffix}`;
        return `${fmtCompact(value)}${valueSuffix}`;
    })();

    const isNA = displayValue === 'N/A';

    return (
        <div className="bg-white rounded-2xl p-5 pb-9 flex flex-col justify-between shadow-sm border border-gray-100 hover:shadow-md transition-shadow duration-300 relative group">
            {badge && <div className="absolute bottom-2.5 right-3 z-10">{badge}</div>}
            <div>
                <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                        <h3 className="text-gray-400 uppercase tracking-wider text-[10px] font-semibold leading-tight">{title}</h3>
                        {tooltip && (
                            <div className="relative group/tooltip">
                                <Info size={12} className="text-gray-300 hover:text-gray-400 cursor-help transition-colors" />
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-white border border-gray-100 rounded-lg shadow-lg opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity duration-200 z-[100] text-[10px] font-medium text-gray-600 leading-relaxed text-center">
                                    {tooltip}
                                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-white" />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className={`text-xl font-bold tracking-tight ${isNA ? 'text-gray-300 italic' : 'text-gray-900'}`}>
                    {displayValue}
                </div>

                {delta !== undefined && (
                    <div className="flex items-center mt-2">
                        <span className={`px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-[10px] font-semibold flex items-center gap-0.5 ${deltaColor}`}>
                            {isPositiveDelta ? <TrendingUp size={11} className="shrink-0" /> : <TrendingDown size={11} className="shrink-0" />}
                            {Math.abs(delta).toFixed(1)}{deltaSuffix}
                            {baselineYear && <span className="text-gray-400 ml-0.5 font-medium">vs {baselineYear}</span>}
                        </span>
                    </div>
                )}
            </div>

            {!hideChart && !isRatio && chartData && chartData.length > 0 && (
                <div className="h-16 w-full mt-3">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ bottom: 0, left: 0, right: 0, top: 4 }}>
                            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                            <Tooltip
                                cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                                contentStyle={{
                                    backgroundColor: '#ffffff',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '10px',
                                    color: '#0f172a',
                                    fontSize: '11px',
                                    padding: '6px 10px',
                                    boxShadow: '0 4px 12px -2px rgb(0 0 0 / 0.08)',
                                }}
                                itemStyle={{ color: '#0f172a', fontWeight: 500, padding: 0 }}
                                labelStyle={{ fontWeight: 600, color: '#64748b', marginBottom: '2px' }}
                                labelFormatter={(label) => `${label}`}
                                formatter={(v: any) => [typeof v === 'number' ? fmtCompact(v) : v, title]}
                            />
                            <Bar dataKey={chartKey} radius={[4, 4, 0, 0]} maxBarSize={28}>
                                {chartData.map((_, i) => {
                                    let c = '#e2e8f0';
                                    if (i === chartData.length - 1) {
                                        if (isNegativeGood) c = isPositiveDelta ? '#fca5a5' : '#6ee7b7';
                                        else c = isPositiveDelta ? '#6ee7b7' : '#fca5a5';
                                    } else {
                                        c = '#cbd5e1';
                                    }
                                    return <Cell key={i} fill={c} />;
                                })}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}
