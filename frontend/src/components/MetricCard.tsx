import { TrendingUp, TrendingDown } from 'lucide-react';
import { BarChart, Bar, Cell, Tooltip, ResponsiveContainer, XAxis } from 'recharts';

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
}

export default function MetricCard({
    title, value, delta, isRatio = false, isNegativeGood = false,
    chartData, chartKey = 'val', baselineYear, suffix, badge
}: MetricCardProps) {
    const isPositiveDelta = typeof delta === 'number' && delta >= 0;
    const valueSuffix = suffix ?? (isRatio ? '%' : '');
    const deltaSuffix = isRatio ? ' p.p.' : '%';

    let deltaColor = 'text-gray-500';
    if (delta !== undefined) {
        if (isNegativeGood) deltaColor = isPositiveDelta ? 'text-red-500' : 'text-green-500';
        else deltaColor = isPositiveDelta ? 'text-green-500' : 'text-red-500';
    }

    return (
        <div className="bg-white rounded-2xl p-5 pb-8 flex flex-col justify-between shadow-sm border border-gray-100/80 hover:shadow-md transition-shadow duration-300 relative">
            {badge && <div className="absolute bottom-2 right-3 z-10">{badge}</div>}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-gray-400 uppercase tracking-wider text-[11px] font-semibold">{title}</h3>
                </div>
                <div className="text-2xl font-bold text-gray-900 tracking-tight">
                    {value !== undefined && value !== null
                        ? (typeof value === 'number' ? `${value.toLocaleString()}${valueSuffix}` : `${value}${valueSuffix}`)
                        : 'N/A'}
                </div>

                {delta !== undefined && (
                    <div className="flex items-center mt-2.5">
                        <span className={`px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-[11px] font-semibold flex items-center ${deltaColor}`}>
                            {isPositiveDelta ? <TrendingUp size={12} className="mr-1" /> : <TrendingDown size={12} className="mr-1" />}
                            {Math.abs(delta).toFixed(1)}{deltaSuffix}
                            {baselineYear && <span className="text-gray-400 ml-1 font-medium">vs {baselineYear}</span>}
                        </span>
                    </div>
                )}
            </div>

            {chartData && chartData.length > 0 && (
                <div className="h-14 w-full mt-3">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ bottom: 0 }}>
                            <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                            <Tooltip
                                cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                                contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a', fontSize: '12px', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                itemStyle={{ color: '#0f172a', fontWeight: 500, padding: 0 }}
                                labelStyle={{ fontWeight: 600, color: '#64748b', marginBottom: '4px' }}
                                labelFormatter={(label) => `${label}`}
                                formatter={(v: any) => [typeof v === 'number' ? `${v.toLocaleString()}${valueSuffix}` : v, title]}
                            />
                            <Bar dataKey={chartKey} radius={[3, 3, 0, 0]}>
                                {chartData.map((_, i) => {
                                    let c = '#cbd5e1';
                                    if (i === chartData.length - 1) {
                                        if (isNegativeGood) c = isPositiveDelta ? '#ef4444' : '#22c55e';
                                        else c = isPositiveDelta ? '#22c55e' : '#ef4444';
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
