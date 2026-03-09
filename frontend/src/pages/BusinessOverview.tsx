import { Globe, Users, Building, Contact, Briefcase, MapPin, Shield, Target } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import type { AnalysisData } from '../types';

const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'];

const CustomXAxisTick = ({ x, y, payload }: any) => {
    if (!payload || !payload.value) return null;
    const words = payload.value.split(' ');
    const firstLine = words[0];
    const secondLine = words.length > 1 ? words.slice(1).join(' ') : '';

    return (
        <g transform={`translate(${x},${y})`}>
            <text x={0} y={0} dy={12} textAnchor="middle" fill="#6b7280" fontSize={10}>
                <tspan textAnchor="middle" x="0" dy="0">{firstLine}</tspan>
                {secondLine && <tspan textAnchor="middle" x="0" dy="12">{secondLine}</tspan>}
            </text>
        </g>
    );
};

export default function BusinessOverview({ data }: { data: AnalysisData }) {
    const ov = data.company_overview;
    const mgmt = data.management_quality ?? [];
    const partners = ov?.strategic_partners ?? [];
    const subsidiaries = ov?.revenue_by_subsidiaries_or_country ?? [];
    const scale = ov?.operational_scale;
    const it = data.quality_of_it;
    const competitive = data.competitive_position;

    const competitors = competitive?.key_competitors ?? [];

    // Match management_quality deep-dive data to team members
    const getManagementDetail = (name: string) => mgmt.find(m => m.name === name);

    // Shareholders for pie chart
    const shareholders = (ov?.shareholder_structure ?? []).map((s, i) => ({
        name: s.name,
        value: s.ownership_percentage ?? 0,
        color: COLORS[i % COLORS.length],
    }));

    const getSourceBadge = (field: string, defaultValue = "Files Upload") => {
        const source = data.data_sources?.company_overview?.[field] || defaultValue;
        return <SourceBadge source={source} />;
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* ──── Product & Market Reach ──── */}
            <section>
                <SectionHeader icon={<Globe className="w-4 h-4" />} title="Product Offerings & Market Reach" color="blue" />

                {/* Description */}
                {ov?.description_of_products_and_services && (
                    <p className="text-gray-600 text-sm leading-relaxed mb-5 max-w-3xl">{ov.description_of_products_and_services}</p>
                )}

                {/* Stats row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <StatCard icon={<Building className="w-4 h-4" />} label="Branches" value={scale?.number_of_branches} badge={getSourceBadge("operational_scale")} />
                    <StatCard icon={<Users className="w-4 h-4" />} label="Employees" value={scale?.number_of_employees ? `${Math.floor(scale.number_of_employees / 10) * 10}+` : undefined} badge={getSourceBadge("operational_scale")} />
                    <StatCard icon={<Contact className="w-4 h-4" />} label="Customers" value={scale?.number_of_customers} badge={getSourceBadge("operational_scale")} />
                    <StatCard icon={<Globe className="w-4 h-4" />} label="Countries" value={ov?.countries_of_operation?.length} badge={getSourceBadge("countries_of_operation")} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* Countries */}
                    {ov?.countries_of_operation && ov.countries_of_operation.length > 0 && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative">
                            <div className="absolute top-4 right-4">{getSourceBadge("countries_of_operation")}</div>
                            <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Countries of Operation</h4>
                            <div className="flex flex-wrap gap-2">
                                {ov.countries_of_operation.map(c => (
                                    <span key={c} className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium border border-blue-100">
                                        <MapPin className="w-3 h-3 inline mr-1 -mt-0.5" />{c}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Revenue by Subsidiaries or Country */}
                    {subsidiaries.length > 0 && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative">
                            <div className="absolute top-4 right-4">{getSourceBadge("revenue_by_subsidiaries_or_country")}</div>
                            <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Total Operating Revenue by Subsidiaries / Country ({data.currency})</h4>
                            <div className="h-64 mt-4">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={subsidiaries} margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                                        <XAxis dataKey="subsidiary_or_country" tick={<CustomXAxisTick />} interval={0} axisLine={false} tickLine={false} height={40} />
                                        <YAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={70} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a', fontSize: '12px', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                            itemStyle={{ color: '#0f172a', fontWeight: 500, padding: 0 }}
                                            formatter={(v: any) => [`${v} ${data.currency}`, 'Total Operating Revenue']}
                                        />
                                        <Bar dataKey="total_operating_revenue" radius={[6, 6, 0, 0]}>
                                            {subsidiaries.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* ──── Leadership & Ownership ──── */}
            <section>
                <SectionHeader icon={<Briefcase className="w-4 h-4" />} title="Leadership & Ownership" color="violet" />

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {/* Management Team */}
                    <div className="lg:col-span-2">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {(ov?.management_team ?? []).map(member => {
                                const detail = getManagementDetail(member.name);
                                return (
                                    <div key={member.name} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow relative">
                                        <div className="absolute top-4 right-4">{getSourceBadge("management_team")}</div>
                                        <div className="flex items-center gap-3 mb-3">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                                                {member.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                                            </div>
                                            <div>
                                                <div className="font-semibold text-gray-900 text-sm">{member.name}</div>
                                                <div className="text-[11px] text-blue-600 font-medium uppercase tracking-wider">{member.position}</div>
                                            </div>
                                        </div>
                                        {detail?.previous_experience && (
                                            <p className="text-xs text-gray-500 leading-relaxed mb-1.5">
                                                <span className="font-semibold text-gray-600">Experience: </span>{detail.previous_experience}
                                            </p>
                                        )}
                                        {detail?.tenure_history && (
                                            <p className="text-xs text-gray-500 leading-relaxed">
                                                <span className="font-semibold text-gray-600">Tenure: </span>{detail.tenure_history}
                                            </p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Shareholders */}
                    {shareholders.length > 0 && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm relative">
                            <div className="absolute top-4 right-4">{getSourceBadge("shareholder_structure")}</div>
                            <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Shareholder Structure</h4>
                            <div className="h-40 mb-3">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={shareholders} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={2} dataKey="value">
                                            {shareholders.map((s, i) => <Cell key={i} fill={s.color} />)}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#0f172a', fontSize: '12px', padding: '8px 12px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' }}
                                            itemStyle={{ color: '#0f172a', fontWeight: 500, padding: 0 }}
                                            formatter={(v: any) => [`${v}%`, 'Ownership']}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="space-y-1.5">
                                {shareholders.map((s, i) => (
                                    <div key={i} className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                                            <span className="text-gray-600 truncate max-w-[160px]">{s.name}</span>
                                        </div>
                                        <span className="font-semibold text-gray-900">{s.value}%</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* ──── Strategic Partners ──── */}
            {partners.length > 0 && (
                <section>
                    <div className="flex items-center justify-between mb-5">
                        <SectionHeader icon={<Shield className="w-4 h-4" />} title="Strategic Partners" color="emerald" noMargin />
                        {getSourceBadge("strategic_partners")}
                    </div>
                    <div className="flex flex-wrap gap-3">
                        {partners.map(p => (
                            <span key={p} className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 shadow-sm hover:shadow-md transition-shadow">
                                {p}
                            </span>
                        ))}
                    </div>
                </section>
            )}

            {/* ──── Key Competitors ──── */}
            {competitors.length > 0 && (
                <section>
                    <SectionHeader icon={<Target className="w-4 h-4" />} title="Key Competitors" color="rose" />
                    <div className="flex flex-wrap gap-3">
                        {competitors.map(c => (
                            <span key={c} className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 shadow-sm hover:shadow-md transition-shadow">
                                {c}
                            </span>
                        ))}
                    </div>
                </section>
            )}

            {/* ──── IT Quality ──── */}
            {it && (
                <section>
                    <SectionHeader icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>} title="Quality of IT & Data Usage" color="cyan" />
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {it.core_banking_systems && it.core_banking_systems.length > 0 && (
                            <ITInfoCard title="Core Banking Systems" items={it.core_banking_systems} />
                        )}
                        {it.digital_channel_adoption && (
                            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Digital Adoption</h4>
                                <p className="text-sm text-gray-600 leading-relaxed">{it.digital_channel_adoption}</p>
                            </div>
                        )}
                        {it.system_upgrades && it.system_upgrades.length > 0 && (
                            <ITInfoCard title="System Upgrades" items={it.system_upgrades} />
                        )}
                        {it.vendor_partnerships && it.vendor_partnerships.length > 0 && (
                            <ITInfoCard title="Vendor Partnerships" items={it.vendor_partnerships} />
                        )}
                        {it.cyber_incidents && it.cyber_incidents.length > 0 && (
                            <ITInfoCard title="Cybersecurity" items={it.cyber_incidents} />
                        )}
                    </div>

                    {/* Hardcoded Sources */}
                    <div className="mt-4 flex gap-2 items-center flex-wrap">
                        <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Sources:</span>
                        <SourceBadge source="Web Search" label="Google Search, News, Vendor Press Releases" />
                    </div>
                </section>
            )}

            {/* ──── Competitive Position ──── */}
            {competitive && (
                <section>
                    <SectionHeader icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>} title="Competitive Position" color="orange" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {competitive.market_share_data && <CompetitiveCard title="Market Share" text={competitive.market_share_data} />}
                        {competitive.central_bank_sector_reports_summary && <CompetitiveCard title="Central Bank Reports" text={competitive.central_bank_sector_reports_summary} />}
                        {competitive.industry_studies_summary && <CompetitiveCard title="Industry Studies" text={competitive.industry_studies_summary} />}
                        {competitive.customer_growth_or_attrition_news && <CompetitiveCard title="Customer Growth" text={competitive.customer_growth_or_attrition_news} />}
                    </div>

                    <div className="mt-4 flex gap-2 items-center flex-wrap">
                        <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Sources:</span>
                        <SourceBadge source="Web Search" label="Google Search, News, Central Bank Sector Reports, Industry Studies" />
                    </div>
                </section>
            )}

            {/* ──── Microfinance Geo-View ──── */}
            {data.macroeconomic_geo_view && data.macroeconomic_geo_view.length > 0 && (
                <section>
                    <SectionHeader icon={<Globe className="w-4 h-4" />} title="Microfinance Geo-View" color="teal" />
                    <div className="mt-4">
                        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-white border-b border-gray-100">
                                            <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Country</th>
                                            <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Population</th>
                                            <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">GDP/Cap (PPP)</th>
                                            <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">GDP Growth</th>
                                            <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Inflation</th>
                                            <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Interest Rate</th>
                                            <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Unemployment</th>
                                            <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Risk Score</th>
                                            <th className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">CPI</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {data.macroeconomic_geo_view.map(g => (
                                            <tr key={g.country} className="hover:bg-gray-50/50 transition-colors">
                                                <td className="px-4 py-3 whitespace-nowrap"><div className="font-bold text-gray-900 text-[13px]">{g.country}</div></td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">{g.population || 'N/A'}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">{g.gdp_per_capita_ppp || 'N/A'}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">{g.gdp_growth_forecast || 'N/A'}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">{g.inflation || 'N/A'}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">{g.central_bank_interest_rate || 'N/A'}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">{g.unemployment_rate || 'N/A'}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">{g.country_risk_rating || 'N/A'}</td>
                                                <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">{g.corruption_perceptions_index_rank || 'N/A'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 flex gap-x-2 gap-y-1 items-center flex-wrap max-w-5xl">
                        <span className="text-xs text-slate-500 font-medium whitespace-nowrap">Sources:</span>
                        <SourceBadge source="Web Search" label="World Bank Open Data (Population)" />
                        <SourceBadge source="Web Search" label="IMF World Economic Outlook (GDP, Inflation)" />
                        <SourceBadge source="Web Search" label="Central Bank or BIS (Interest Rate)" />
                        <SourceBadge source="Web Search" label="ILOSTAT (Unemployment)" />
                        <SourceBadge source="Web Search" label="Atradius Country Risk Map (Risk Score)" />
                        <SourceBadge source="Web Search" label="Transparency International (CPI)" />
                    </div>
                </section>
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

function StatCard({ icon, label, value, badge }: { icon: React.ReactNode; label: string; value?: number | string; badge?: React.ReactNode }) {
    return (
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3 relative">
            {badge && <div className="absolute top-2 right-2">{badge}</div>}
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center flex-shrink-0">{icon}</div>
            <div>
                <div className="text-xl font-bold text-gray-900">{value !== undefined ? (typeof value === 'number' ? value.toLocaleString() : value) : '—'}</div>
                <div className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">{label}</div>
            </div>
        </div>
    );
}

function ITInfoCard({ title, items }: { title: string; items: string[] }) {
    return (
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h4>
            <ul className="space-y-1.5">
                {items.map((item, i) => (
                    <li key={i} className="text-sm text-gray-600 leading-relaxed flex items-start">
                        <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full mt-1.5 mr-2 flex-shrink-0" />
                        {item}
                    </li>
                ))}
            </ul>
        </div>
    );
}

function CompetitiveCard({ title, text }: { title: string; text: string }) {
    return (
        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
            <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{title}</h4>
            <p className="text-sm text-gray-600 leading-relaxed">{text}</p>
        </div>
    );
}

export function SourceBadge({ source, label }: { source: string, label?: string }) {
    const isWeb = source.toLowerCase().includes('web');

    return (
        <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border
                ${isWeb
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60 shadow-sm'
                    : 'bg-blue-50/70 text-blue-700 border-blue-200/60'
                }`}
        >
            {isWeb ? <Globe className="w-2.5 h-2.5" /> : (
                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
            )}
            {label || source}
        </span>
    );
}
