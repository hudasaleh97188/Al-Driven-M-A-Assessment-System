import { Globe, Users, Building, Contact, Briefcase, MapPin, Shield } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import type { AnalysisData } from '../types';

const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4'];

export default function BusinessOverview({ data }: { data: AnalysisData }) {
    const ov = data.company_overview;
    const mgmt = data.management_quality ?? [];
    const geo = data.macroeconomic_geo_view ?? [];
    const partners = ov?.strategic_partners ?? [];
    const segments = ov?.revenue_by_segment_or_geography ?? [];
    const scale = ov?.operational_scale;
    const it = data.quality_of_it;
    const competitive = data.competitive_position;

    // Match management_quality deep-dive data to team members
    const getManagementDetail = (name: string) => mgmt.find(m => m.name === name);

    // Shareholders for pie chart
    const shareholders = (ov?.shareholder_structure ?? []).map((s, i) => ({
        name: s.name,
        value: s.ownership_percentage ?? 0,
        color: COLORS[i % COLORS.length],
    }));

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
                    <StatCard icon={<Building className="w-4 h-4" />} label="Branches" value={scale?.number_of_branches} />
                    <StatCard icon={<Users className="w-4 h-4" />} label="Employees" value={scale?.number_of_employees} />
                    <StatCard icon={<Contact className="w-4 h-4" />} label="Customers" value={scale?.number_of_borrowers} />
                    <StatCard icon={<Globe className="w-4 h-4" />} label="Countries" value={ov?.countries_of_operation?.length} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* Countries */}
                    {ov?.countries_of_operation && ov.countries_of_operation.length > 0 && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
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

                    {/* Revenue by Segment */}
                    {segments.length > 0 && (
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                            <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Revenue by Segment ({data.currency})</h4>
                            <div className="h-44">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={segments} layout="vertical" margin={{ left: 10, right: 20 }}>
                                        <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                                        <YAxis type="category" dataKey="segment_name" width={120} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '12px' }}
                                            formatter={(v: any) => [`${v} ${data.currency}`, 'Revenue']}
                                        />
                                        <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
                                            {segments.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
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
                                    <div key={member.name} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
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
                        <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                            <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Shareholder Structure</h4>
                            <div className="h-40 mb-3">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={shareholders} cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={2} dataKey="value">
                                            {shareholders.map((s, i) => <Cell key={i} fill={s.color} />)}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '11px' }}
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
                    <SectionHeader icon={<Shield className="w-4 h-4" />} title="Strategic Partners" color="emerald" />
                    <div className="flex flex-wrap gap-3">
                        {partners.map(p => (
                            <span key={p} className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 shadow-sm hover:shadow-md transition-shadow">
                                {p}
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
                </section>
            )}

            {/* ──── Microfinance Geo-View ──── */}
            {geo.length > 0 && (
                <section>
                    <SectionHeader icon={<MapPin className="w-4 h-4" />} title="Microfinance Geo-View" color="rose" />
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="border-b border-gray-100 bg-gray-50/50">
                                        <th className="p-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Country</th>
                                        <th className="p-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">GDP/Cap (PPP)</th>
                                        <th className="p-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Inflation</th>
                                        <th className="p-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Risk Score</th>
                                        <th className="p-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">CPI</th>
                                        <th className="p-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Financial Inclusion</th>
                                        <th className="p-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Credit/GDP</th>
                                        <th className="p-4 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Mobile Money</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {geo.map(g => (
                                        <tr key={g.country} className="hover:bg-blue-50/30 transition-colors">
                                            <td className="p-4 font-semibold text-gray-900">{g.country}</td>
                                            <td className="p-4 text-gray-600">{g.gdp_per_capita_ppp || '—'}</td>
                                            <td className="p-4 text-gray-600">{g.inflation_projection || '—'}</td>
                                            <td className="p-4 text-gray-600">{g.country_risk_score || '—'}</td>
                                            <td className="p-4 text-gray-600">{g.corruption_perceptions_index || '—'}</td>
                                            <td className="p-4 text-gray-600">{g.financial_inclusion_rate || '—'}</td>
                                            <td className="p-4 text-gray-600">{g.credit_to_gdp_ratio || '—'}</td>
                                            <td className="p-4 text-gray-600">{g.mobile_money_adoption || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}

/* ── Sub-components ── */

function SectionHeader({ icon, title, color }: { icon: React.ReactNode; title: string; color: string }) {
    const colorMap: Record<string, string> = {
        blue: 'bg-blue-100 text-blue-600',
        violet: 'bg-violet-100 text-violet-600',
        emerald: 'bg-emerald-100 text-emerald-600',
        cyan: 'bg-cyan-100 text-cyan-600',
        orange: 'bg-orange-100 text-orange-600',
        rose: 'bg-rose-100 text-rose-600',
    };
    return (
        <div className="flex items-center gap-2.5 mb-5">
            <div className={`w-7 h-7 rounded-lg ${colorMap[color] ?? colorMap.blue} flex items-center justify-center`}>{icon}</div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
        </div>
    );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value?: number }) {
    return (
        <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center flex-shrink-0">{icon}</div>
            <div>
                <div className="text-xl font-bold text-gray-900">{value?.toLocaleString() ?? '—'}</div>
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
