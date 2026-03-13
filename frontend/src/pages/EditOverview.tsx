import { useState, useMemo } from 'react';
import { Save, ArrowLeft, AlertCircle } from 'lucide-react';
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

function extractFields(data: AnalysisData): FieldDef[] {
    const fields: FieldDef[] = [];
    const ov = data.company_overview;
    const scale = ov?.operational_scale;

    // Company Overview text fields
    if (ov?.description_of_products_and_services !== undefined) {
        fields.push({
            path: 'company_overview.description_of_products_and_services',
            label: 'Products & Services Description',
            section: 'Company Overview',
            type: 'textarea',
            currentValue: ov.description_of_products_and_services || '',
        });
    }

    // Operational Scale
    if (scale) {
        if (scale.number_of_branches !== undefined) {
            fields.push({
                path: 'company_overview.operational_scale.number_of_branches',
                label: 'Number of Branches',
                section: 'Operational Scale',
                type: 'number',
                currentValue: String(scale.number_of_branches || ''),
            });
        }
        if (scale.number_of_employees !== undefined) {
            fields.push({
                path: 'company_overview.operational_scale.number_of_employees',
                label: 'Number of Employees',
                section: 'Operational Scale',
                type: 'number',
                currentValue: String(scale.number_of_employees || ''),
            });
        }
        if (scale.number_of_customers !== undefined) {
            fields.push({
                path: 'company_overview.operational_scale.number_of_customers',
                label: 'Number of Customers',
                section: 'Operational Scale',
                type: 'number',
                currentValue: String(scale.number_of_customers || ''),
            });
        }
    }

    // Countries
    if (ov?.countries_of_operation) {
        fields.push({
            path: 'company_overview.countries_of_operation',
            label: 'Countries of Operation (comma-separated)',
            section: 'Company Overview',
            type: 'text',
            currentValue: Array.isArray(ov.countries_of_operation) ? ov.countries_of_operation.join(', ') : String(ov.countries_of_operation),
        });
    }

    // Strategic Partners
    if (ov?.strategic_partners) {
        fields.push({
            path: 'company_overview.strategic_partners',
            label: 'Strategic Partners (comma-separated)',
            section: 'Company Overview',
            type: 'text',
            currentValue: Array.isArray(ov.strategic_partners) ? ov.strategic_partners.join(', ') : String(ov.strategic_partners),
        });
    }

    // Management Team
    (ov?.management_team ?? []).forEach((m, i) => {
        fields.push({
            path: `company_overview.management_team[${i}].name`,
            label: `Management #${i + 1} - Name`,
            section: 'Management Team',
            type: 'text',
            currentValue: m.name,
        });
        fields.push({
            path: `company_overview.management_team[${i}].position`,
            label: `Management #${i + 1} - Position`,
            section: 'Management Team',
            type: 'text',
            currentValue: m.position,
        });
    });

    // Shareholders
    (ov?.shareholder_structure ?? []).forEach((s, i) => {
        fields.push({
            path: `company_overview.shareholder_structure[${i}].name`,
            label: `Shareholder #${i + 1} - Name`,
            section: 'Shareholders',
            type: 'text',
            currentValue: s.name,
        });
        fields.push({
            path: `company_overview.shareholder_structure[${i}].ownership_percentage`,
            label: `Shareholder #${i + 1} - Ownership %`,
            section: 'Shareholders',
            type: 'number',
            currentValue: String(s.ownership_percentage || ''),
        });
    });

    // Competitive Position
    const cp = data.competitive_position;
    if (cp) {
        if (cp.key_competitors) {
            fields.push({
                path: 'competitive_position.key_competitors',
                label: 'Key Competitors (comma-separated)',
                section: 'Competitive Position',
                type: 'text',
                currentValue: Array.isArray(cp.key_competitors) ? cp.key_competitors.join(', ') : String(cp.key_competitors),
            });
        }
        if (cp.market_share_data) {
            fields.push({
                path: 'competitive_position.market_share_data',
                label: 'Market Share Data',
                section: 'Competitive Position',
                type: 'textarea',
                currentValue: cp.market_share_data,
            });
        }
    }

    return fields;
}

export default function EditOverview({ data, onBack, onSaved }: Props) {
    const fields = useMemo(() => extractFields(data), [data]);
    const [editValues, setEditValues] = useState<Record<string, string>>({});
    const [editComments, setEditComments] = useState<Record<string, string>>({});
    const [globalComment, setGlobalComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const pendingEdits = useMemo(() => {
        return fields.filter(f => {
            const newVal = editValues[f.path];
            return newVal !== undefined && newVal !== f.currentValue;
        }).map(f => ({
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

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
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
                        <p className="text-sm text-gray-500 mt-0.5">{data.company_name}</p>
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

            {/* Global Comment */}
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

            {/* Sections */}
            {sections.map(([sectionName, sectionFields]) => (
                <div key={sectionName} className="mb-8">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-1 h-6 bg-blue-500 rounded-full" />
                        <h3 className="text-lg font-bold text-gray-900">{sectionName}</h3>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                    <div className="text-xs text-gray-400 mb-2 truncate">
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
                </div>
            ))}

            {/* Pending Changes Summary */}
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
                                        <td className="px-4 py-2 text-gray-500 max-w-[200px] truncate">{e.old_value || '(empty)'}</td>
                                        <td className="px-4 py-2 text-blue-700 font-semibold max-w-[200px] truncate">{e.new_value}</td>
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

            {/* Bottom Save */}
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
