import { useState, useMemo } from 'react';
import { Save, ArrowLeft, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { editOverview } from '../api';
import type { AnalysisData } from '../types';

interface Props {
    data: AnalysisData;
    onBack: () => void;
    onSaved: () => void;
}

interface FieldDef {
    path: string;
    label: string;
    section: string;
    type: 'text' | 'number' | 'textarea';
    currentValue: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field extraction — walks the entire AnalysisData tree and creates an
// editable FieldDef for every leaf value the user might want to change.
// ─────────────────────────────────────────────────────────────────────────────

function extractFields(data: AnalysisData): FieldDef[] {
    const fields: FieldDef[] = [];
    const ov = data.company_overview;
    const scale = ov?.operational_scale;

    // ── Company Overview ─────────────────────────────────────────────────
    if (ov?.description_of_products_and_services !== undefined) {
        fields.push({
            path: 'company_overview.description_of_products_and_services',
            label: 'Products & Services Description',
            section: 'Company Overview',
            type: 'textarea',
            currentValue: ov.description_of_products_and_services || '',
        });
    }

    // Countries
    if (ov?.countries_of_operation) {
        fields.push({
            path: 'company_overview.countries_of_operation',
            label: 'Countries of Operation (comma-separated)',
            section: 'Company Overview',
            type: 'text',
            currentValue: Array.isArray(ov.countries_of_operation)
                ? ov.countries_of_operation.join(', ')
                : String(ov.countries_of_operation),
        });
    }

    // Strategic Partners
    if (ov?.strategic_partners) {
        fields.push({
            path: 'company_overview.strategic_partners',
            label: 'Strategic Partners (comma-separated)',
            section: 'Company Overview',
            type: 'text',
            currentValue: Array.isArray(ov.strategic_partners)
                ? ov.strategic_partners.join(', ')
                : String(ov.strategic_partners),
        });
    }

    // ── Operational Scale ────────────────────────────────────────────────
    if (scale) {
        if (scale.number_of_branches !== undefined) {
            fields.push({
                path: 'company_overview.operational_scale.number_of_branches',
                label: 'Number of Branches',
                section: 'Operational Scale',
                type: 'number',
                currentValue: String(scale.number_of_branches ?? ''),
            });
        }
        if (scale.number_of_employees !== undefined) {
            fields.push({
                path: 'company_overview.operational_scale.number_of_employees',
                label: 'Number of Employees',
                section: 'Operational Scale',
                type: 'number',
                currentValue: String(scale.number_of_employees ?? ''),
            });
        }
        if (scale.number_of_customers !== undefined) {
            fields.push({
                path: 'company_overview.operational_scale.number_of_customers',
                label: 'Number of Customers',
                section: 'Operational Scale',
                type: 'number',
                currentValue: String(scale.number_of_customers ?? ''),
            });
        }
    }

    // ── Revenue by Subsidiaries / Country ────────────────────────────────
    (ov?.revenue_by_subsidiaries_or_country ?? []).forEach((s, i) => {
        fields.push({
            path: `company_overview.revenue_by_subsidiaries_or_country[${i}].subsidiary_or_country`,
            label: `Subsidiary #${i + 1} — Name`,
            section: 'Revenue by Subsidiary / Country',
            type: 'text',
            currentValue: s.subsidiary_or_country || '',
        });
        fields.push({
            path: `company_overview.revenue_by_subsidiaries_or_country[${i}].total_operating_revenue`,
            label: `Subsidiary #${i + 1} — Revenue`,
            section: 'Revenue by Subsidiary / Country',
            type: 'number',
            currentValue: String(s.total_operating_revenue ?? ''),
        });
    });

    // ── Management Team ──────────────────────────────────────────────────
    (ov?.management_team ?? []).forEach((m, i) => {
        fields.push({
            path: `company_overview.management_team[${i}].name`,
            label: `Manager #${i + 1} — Name`,
            section: 'Management Team',
            type: 'text',
            currentValue: m.name,
        });
        fields.push({
            path: `company_overview.management_team[${i}].position`,
            label: `Manager #${i + 1} — Position`,
            section: 'Management Team',
            type: 'text',
            currentValue: m.position,
        });
    });

    // ── Management Quality (deep-dive from LLM Stage 2) ─────────────────
    (data.management_quality ?? []).forEach((m, i) => {
        fields.push({
            path: `management_quality[${i}].name`,
            label: `Leader #${i + 1} — Name`,
            section: 'Management Quality',
            type: 'text',
            currentValue: m.name || '',
        });
        if (m.position !== undefined) {
            fields.push({
                path: `management_quality[${i}].position`,
                label: `Leader #${i + 1} — Position`,
                section: 'Management Quality',
                type: 'text',
                currentValue: m.position || '',
            });
        }
        if (m.previous_experience !== undefined) {
            fields.push({
                path: `management_quality[${i}].previous_experience`,
                label: `Leader #${i + 1} — Previous Experience`,
                section: 'Management Quality',
                type: 'textarea',
                currentValue: m.previous_experience || '',
            });
        }
        if (m.tenure_history !== undefined) {
            fields.push({
                path: `management_quality[${i}].tenure_history`,
                label: `Leader #${i + 1} — Tenure History`,
                section: 'Management Quality',
                type: 'textarea',
                currentValue: m.tenure_history || '',
            });
        }
    });

    // ── Shareholders ─────────────────────────────────────────────────────
    (ov?.shareholder_structure ?? []).forEach((s, i) => {
        fields.push({
            path: `company_overview.shareholder_structure[${i}].name`,
            label: `Shareholder #${i + 1} — Name`,
            section: 'Shareholders',
            type: 'text',
            currentValue: s.name,
        });
        fields.push({
            path: `company_overview.shareholder_structure[${i}].ownership_percentage`,
            label: `Shareholder #${i + 1} — Ownership %`,
            section: 'Shareholders',
            type: 'number',
            currentValue: String(s.ownership_percentage ?? ''),
        });
    });

    // ── Quality of IT & Data Usage ───────────────────────────────────────
    const it = data.quality_of_it;
    if (it) {
        if (it.core_banking_systems) {
            fields.push({
                path: 'quality_of_it.core_banking_systems',
                label: 'Core Banking Systems (comma-separated)',
                section: 'Quality of IT & Data Usage',
                type: 'text',
                currentValue: Array.isArray(it.core_banking_systems)
                    ? it.core_banking_systems.join(', ')
                    : String(it.core_banking_systems),
            });
        }
        if (it.digital_channel_adoption !== undefined) {
            fields.push({
                path: 'quality_of_it.digital_channel_adoption',
                label: 'Digital Channel Adoption',
                section: 'Quality of IT & Data Usage',
                type: 'textarea',
                currentValue: it.digital_channel_adoption || '',
            });
        }
        if (it.system_upgrades) {
            fields.push({
                path: 'quality_of_it.system_upgrades',
                label: 'System Upgrades (comma-separated)',
                section: 'Quality of IT & Data Usage',
                type: 'text',
                currentValue: Array.isArray(it.system_upgrades)
                    ? it.system_upgrades.join(', ')
                    : String(it.system_upgrades),
            });
        }
        if (it.vendor_partnerships) {
            fields.push({
                path: 'quality_of_it.vendor_partnerships',
                label: 'Vendor Partnerships (comma-separated)',
                section: 'Quality of IT & Data Usage',
                type: 'text',
                currentValue: Array.isArray(it.vendor_partnerships)
                    ? it.vendor_partnerships.join(', ')
                    : String(it.vendor_partnerships),
            });
        }
        if (it.cyber_incidents) {
            fields.push({
                path: 'quality_of_it.cyber_incidents',
                label: 'Cybersecurity Incidents (comma-separated)',
                section: 'Quality of IT & Data Usage',
                type: 'text',
                currentValue: Array.isArray(it.cyber_incidents)
                    ? it.cyber_incidents.join(', ')
                    : String(it.cyber_incidents),
            });
        }
    }

    // ── Competitive Position ─────────────────────────────────────────────
    const cp = data.competitive_position;
    if (cp) {
        if (cp.key_competitors) {
            fields.push({
                path: 'competitive_position.key_competitors',
                label: 'Key Competitors (comma-separated)',
                section: 'Competitive Position',
                type: 'text',
                currentValue: Array.isArray(cp.key_competitors)
                    ? cp.key_competitors.join(', ')
                    : String(cp.key_competitors),
            });
        }
        if (cp.market_share_data !== undefined) {
            fields.push({
                path: 'competitive_position.market_share_data',
                label: 'Market Share Data',
                section: 'Competitive Position',
                type: 'textarea',
                currentValue: cp.market_share_data || '',
            });
        }
        if (cp.central_bank_sector_reports_summary !== undefined) {
            fields.push({
                path: 'competitive_position.central_bank_sector_reports_summary',
                label: 'Central Bank Sector Reports Summary',
                section: 'Competitive Position',
                type: 'textarea',
                currentValue: cp.central_bank_sector_reports_summary || '',
            });
        }
        if (cp.industry_studies_summary !== undefined) {
            fields.push({
                path: 'competitive_position.industry_studies_summary',
                label: 'Industry Studies Summary',
                section: 'Competitive Position',
                type: 'textarea',
                currentValue: cp.industry_studies_summary || '',
            });
        }
        if (cp.customer_growth_or_attrition_news !== undefined) {
            fields.push({
                path: 'competitive_position.customer_growth_or_attrition_news',
                label: 'Customer Growth / Attrition News',
                section: 'Competitive Position',
                type: 'textarea',
                currentValue: cp.customer_growth_or_attrition_news || '',
            });
        }
    }

    // ── Anomalies & Risks ────────────────────────────────────────────────
    (data.anomalies_and_risks ?? []).forEach((a, i) => {
        fields.push({
            path: `anomalies_and_risks[${i}].category`,
            label: `Risk #${i + 1} — Category`,
            section: 'Anomalies & Risks',
            type: 'text',
            currentValue: a.category || '',
        });
        fields.push({
            path: `anomalies_and_risks[${i}].description`,
            label: `Risk #${i + 1} — Description`,
            section: 'Anomalies & Risks',
            type: 'textarea',
            currentValue: a.description || '',
        });
        fields.push({
            path: `anomalies_and_risks[${i}].severity_level`,
            label: `Risk #${i + 1} — Severity Level`,
            section: 'Anomalies & Risks',
            type: 'text',
            currentValue: a.severity_level || '',
        });
        fields.push({
            path: `anomalies_and_risks[${i}].valuation_impact`,
            label: `Risk #${i + 1} — Valuation Impact`,
            section: 'Anomalies & Risks',
            type: 'textarea',
            currentValue: a.valuation_impact || '',
        });
        fields.push({
            path: `anomalies_and_risks[${i}].negotiation_leverage`,
            label: `Risk #${i + 1} — Negotiation Leverage`,
            section: 'Anomalies & Risks',
            type: 'textarea',
            currentValue: a.negotiation_leverage || '',
        });
    });

    // ── Macroeconomic Geo-View ───────────────────────────────────────────
    (data.macroeconomic_geo_view ?? []).forEach((g, i) => {
        const country = g.country || `Country #${i + 1}`;
        fields.push({
            path: `macroeconomic_geo_view[${i}].country`,
            label: `${country} — Country Name`,
            section: 'Macroeconomic Geo-View',
            type: 'text',
            currentValue: g.country || '',
        });
        if (g.population !== undefined) {
            fields.push({
                path: `macroeconomic_geo_view[${i}].population`,
                label: `${country} — Population`,
                section: 'Macroeconomic Geo-View',
                type: 'text',
                currentValue: g.population || '',
            });
        }
        if (g.gdp_per_capita_ppp !== undefined) {
            fields.push({
                path: `macroeconomic_geo_view[${i}].gdp_per_capita_ppp`,
                label: `${country} — GDP/Capita (PPP)`,
                section: 'Macroeconomic Geo-View',
                type: 'text',
                currentValue: g.gdp_per_capita_ppp || '',
            });
        }
        if (g.gdp_growth_forecast !== undefined) {
            fields.push({
                path: `macroeconomic_geo_view[${i}].gdp_growth_forecast`,
                label: `${country} — GDP Growth Forecast`,
                section: 'Macroeconomic Geo-View',
                type: 'text',
                currentValue: g.gdp_growth_forecast || '',
            });
        }
        if (g.inflation !== undefined) {
            fields.push({
                path: `macroeconomic_geo_view[${i}].inflation`,
                label: `${country} — Inflation`,
                section: 'Macroeconomic Geo-View',
                type: 'text',
                currentValue: g.inflation || '',
            });
        }
        if (g.central_bank_interest_rate !== undefined) {
            fields.push({
                path: `macroeconomic_geo_view[${i}].central_bank_interest_rate`,
                label: `${country} — Central Bank Interest Rate`,
                section: 'Macroeconomic Geo-View',
                type: 'text',
                currentValue: g.central_bank_interest_rate || '',
            });
        }
        if (g.unemployment_rate !== undefined) {
            fields.push({
                path: `macroeconomic_geo_view[${i}].unemployment_rate`,
                label: `${country} — Unemployment Rate`,
                section: 'Macroeconomic Geo-View',
                type: 'text',
                currentValue: g.unemployment_rate || '',
            });
        }
        if (g.country_risk_rating !== undefined) {
            fields.push({
                path: `macroeconomic_geo_view[${i}].country_risk_rating`,
                label: `${country} — Country Risk Rating`,
                section: 'Macroeconomic Geo-View',
                type: 'text',
                currentValue: g.country_risk_rating || '',
            });
        }
        if (g.corruption_perceptions_index_rank !== undefined) {
            fields.push({
                path: `macroeconomic_geo_view[${i}].corruption_perceptions_index_rank`,
                label: `${country} — CPI Rank`,
                section: 'Macroeconomic Geo-View',
                type: 'text',
                currentValue: g.corruption_perceptions_index_rank || '',
            });
        }
    });

    return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// Section color mapping
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_COLORS: Record<string, { bar: string; bg: string; text: string; count: string }> = {
    'Company Overview':                 { bar: 'bg-blue-500',    bg: 'bg-blue-50',    text: 'text-blue-800',    count: 'bg-blue-100 text-blue-700' },
    'Operational Scale':                { bar: 'bg-indigo-500',  bg: 'bg-indigo-50',  text: 'text-indigo-800',  count: 'bg-indigo-100 text-indigo-700' },
    'Revenue by Subsidiary / Country':  { bar: 'bg-violet-500',  bg: 'bg-violet-50',  text: 'text-violet-800',  count: 'bg-violet-100 text-violet-700' },
    'Management Team':                  { bar: 'bg-purple-500', bg: 'bg-purple-50',  text: 'text-purple-800',  count: 'bg-purple-100 text-purple-700' },
    'Management Quality':               { bar: 'bg-fuchsia-500',bg: 'bg-fuchsia-50', text: 'text-fuchsia-800', count: 'bg-fuchsia-100 text-fuchsia-700' },
    'Shareholders':                     { bar: 'bg-pink-500',   bg: 'bg-pink-50',    text: 'text-pink-800',    count: 'bg-pink-100 text-pink-700' },
    'Quality of IT & Data Usage':       { bar: 'bg-cyan-500',   bg: 'bg-cyan-50',    text: 'text-cyan-800',    count: 'bg-cyan-100 text-cyan-700' },
    'Competitive Position':             { bar: 'bg-orange-500', bg: 'bg-orange-50',  text: 'text-orange-800',  count: 'bg-orange-100 text-orange-700' },
    'Anomalies & Risks':                { bar: 'bg-red-500',    bg: 'bg-red-50',     text: 'text-red-800',     count: 'bg-red-100 text-red-700' },
    'Macroeconomic Geo-View':           { bar: 'bg-teal-500',   bg: 'bg-teal-50',    text: 'text-teal-800',    count: 'bg-teal-100 text-teal-700' },
};

const DEFAULT_COLOR = { bar: 'bg-gray-500', bg: 'bg-gray-50', text: 'text-gray-800', count: 'bg-gray-100 text-gray-700' };

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function EditOverview({ data, onBack, onSaved }: Props) {
    const fields = useMemo(() => extractFields(data), [data]);
    const [editValues, setEditValues] = useState<Record<string, string>>({});
    const [editComments, setEditComments] = useState<Record<string, string>>({});
    const [globalComment, setGlobalComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

    const pendingEdits = useMemo(() => {
        return fields
            .filter(f => {
                const newVal = editValues[f.path];
                return newVal !== undefined && newVal !== f.currentValue;
            })
            .map(f => ({
                field_path: f.path,
                label: f.label,
                old_value: f.currentValue,
                new_value: editValues[f.path],
                comment: editComments[f.path] || globalComment || '',
            }));
    }, [fields, editValues, editComments, globalComment]);

    const hasEmptyComments = pendingEdits.some(e => !e.comment.trim());

    const handleSave = async () => {
        if (pendingEdits.length === 0) {
            onBack();
            return;
        }
        if (hasEmptyComments) {
            setError('All changes require a comment explaining the reason.');
            return;
        }
        setSaving(true);
        setError('');
        try {
            await editOverview(
                data.run_id || 1,
                pendingEdits.map(e => ({
                    field_path: e.field_path,
                    old_value: e.old_value,
                    new_value: e.new_value,
                    comment: e.comment,
                }))
            );
            onSaved();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    // Group fields by section
    const sections = useMemo(() => {
        const map = new Map<string, FieldDef[]>();
        for (const f of fields) {
            if (!map.has(f.section)) map.set(f.section, []);
            map.get(f.section)!.push(f);
        }
        return Array.from(map.entries());
    }, [fields]);

    const toggleSection = (name: string) => {
        setCollapsed(prev => ({ ...prev, [name]: !prev[name] }));
    };

    // Count changes per section
    const changesPerSection = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const edit of pendingEdits) {
            const field = fields.find(f => f.path === edit.field_path);
            if (field) {
                counts[field.section] = (counts[field.section] || 0) + 1;
            }
        }
        return counts;
    }, [pendingEdits, fields]);

    return (
        <div className="max-w-5xl mx-auto">
            {/* ── Header ── */}
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium"
                    >
                        <ArrowLeft size={16} />
                        Back
                    </button>
                    <div>
                        <h1 className="text-2xl font-extrabold text-gray-900">Edit Business Overview</h1>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {data.company_name} — {fields.length} editable fields across {sections.length} sections
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {pendingEdits.length > 0 && (
                        <span className="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-xs font-semibold border border-amber-200">
                            {pendingEdits.length} change{pendingEdits.length !== 1 ? 's' : ''} pending
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving || (pendingEdits.length > 0 && hasEmptyComments)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
                    >
                        <Save size={14} />
                        {saving ? 'Saving...' : 'Save & Return'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle size={18} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-red-700">{error}</p>
                </div>
            )}

            {/* ── Global Comment ── */}
            <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl p-4">
                <label className="block text-sm font-semibold text-blue-800 mb-2">
                    Global Comment (applies to all changes without individual comments)
                </label>
                <textarea
                    value={globalComment}
                    onChange={e => setGlobalComment(e.target.value)}
                    placeholder="e.g., Updated based on latest annual report 2024"
                    className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                    rows={2}
                />
            </div>

            {/* ── Sections ── */}
            {sections.map(([sectionName, sectionFields]) => {
                const isCollapsed = collapsed[sectionName] ?? false;
                const colors = SECTION_COLORS[sectionName] || DEFAULT_COLOR;
                const sectionChanges = changesPerSection[sectionName] || 0;

                return (
                    <div key={sectionName} className="mb-4">
                        {/* Section header — clickable to collapse/expand */}
                        <button
                            onClick={() => toggleSection(sectionName)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl ${colors.bg} border border-transparent hover:border-gray-200 transition-colors`}
                        >
                            <div className={`w-1 h-6 ${colors.bar} rounded-full flex-shrink-0`} />
                            {isCollapsed
                                ? <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                                : <ChevronDown size={16} className="text-gray-400 flex-shrink-0" />
                            }
                            <h3 className={`text-base font-bold ${colors.text} flex-1 text-left`}>{sectionName}</h3>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors.count}`}>
                                {sectionFields.length} field{sectionFields.length !== 1 ? 's' : ''}
                            </span>
                            {sectionChanges > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
                                    {sectionChanges} changed
                                </span>
                            )}
                        </button>

                        {/* Fields grid */}
                        {!isCollapsed && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 pl-4">
                                {sectionFields.map(field => {
                                    const val = editValues[field.path] ?? field.currentValue;
                                    const isChanged = editValues[field.path] !== undefined && editValues[field.path] !== field.currentValue;

                                    return (
                                        <div
                                            key={field.path}
                                            className={`bg-white rounded-xl border p-4 transition-colors ${
                                                field.type === 'textarea' ? 'md:col-span-2' : ''
                                            } ${isChanged ? 'border-amber-300 bg-amber-50/30' : 'border-gray-100'}`}
                                        >
                                            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                                                {field.label}
                                            </label>
                                            <div className="text-xs text-gray-400 mb-2 truncate" title={field.currentValue || '(empty)'}>
                                                Current: {field.currentValue || '(empty)'}
                                            </div>
                                            {field.type === 'textarea' ? (
                                                <textarea
                                                    value={val}
                                                    onChange={e => setEditValues(prev => ({ ...prev, [field.path]: e.target.value }))}
                                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                                                    rows={3}
                                                />
                                            ) : (
                                                <input
                                                    type={field.type}
                                                    value={val}
                                                    onChange={e => setEditValues(prev => ({ ...prev, [field.path]: e.target.value }))}
                                                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-300"
                                                />
                                            )}
                                            {isChanged && (
                                                <input
                                                    type="text"
                                                    placeholder="Reason for change (required)"
                                                    value={editComments[field.path] || ''}
                                                    onChange={e => setEditComments(prev => ({ ...prev, [field.path]: e.target.value }))}
                                                    className="w-full mt-2 px-3 py-2 border border-amber-200 rounded-lg text-xs bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-300"
                                                />
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* ── Pending Changes Summary ── */}
            {pendingEdits.length > 0 && (
                <div className="mt-8 mb-12">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">Pending Changes Summary</h3>
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-amber-50 border-b border-amber-100">
                                    <th className="text-left px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Field</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Current</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">New Value</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Comment</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {pendingEdits.map((e, i) => (
                                    <tr key={i} className={!e.comment.trim() ? 'bg-red-50/50' : ''}>
                                        <td className="px-4 py-2 text-gray-700 font-medium">{e.label}</td>
                                        <td className="px-4 py-2 text-gray-500 max-w-[200px] truncate" title={e.old_value}>{e.old_value || '(empty)'}</td>
                                        <td className="px-4 py-2 text-blue-700 font-semibold max-w-[200px] truncate" title={e.new_value}>{e.new_value}</td>
                                        <td className="px-4 py-2 text-gray-600">
                                            {e.comment || <span className="text-red-500 text-xs font-medium">Comment required</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── Bottom Save Bar ── */}
            <div className="sticky bottom-0 bg-white/90 backdrop-blur-sm border-t border-gray-100 py-4 -mx-6 px-6 flex justify-end gap-3">
                <button
                    onClick={onBack}
                    className="px-5 py-2.5 text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg text-sm font-semibold transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSave}
                    disabled={saving || (pendingEdits.length > 0 && hasEmptyComments)}
                    className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
                >
                    <Save size={14} />
                    {saving ? 'Saving...' : pendingEdits.length > 0 ? `Save ${pendingEdits.length} Change${pendingEdits.length !== 1 ? 's' : ''} & Return` : 'Return'}
                </button>
            </div>
        </div>
    );
}
