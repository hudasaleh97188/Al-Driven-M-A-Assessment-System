import { useState, useEffect, useMemo } from 'react';
import { Save, ArrowLeft, AlertCircle } from 'lucide-react';
import { fetchFinancialStatement, bulkEditFinancials } from '../api';
import type { FinancialStatement, FinancialLineItem } from '../types';

interface Props {
    statementId: number;
    companyName: string;
    onBack: () => void;
}

interface PendingEdit {
    lineItemId?: number | null;
    metricName?: string | null;
    itemLabel: string;
    oldValue: number;
    newValue: number;
    comment: string;
}

const METRIC_LABELS: Record<string, string> = {
    total_assets: 'Total Assets',
    total_liabilities: 'Total Liabilities',
    total_equity: 'Total Equity',
    total_operating_revenue: 'Total Operating Revenue',
    total_operating_expenses: 'Total Operating Expenses',
    pat: 'PAT (Net Income)',
    net_interests: 'Net Interest Income',
    ebitda: 'EBITDA',
    gross_loan_portfolio: 'Gross Loan Portfolio',
    gross_non_performing_loans: 'Gross Non-Performing Loans',
    total_loan_loss_provisions: 'Total Loan Loss Provisions',
    debts_to_clients: 'Debts to Clients (Deposits)',
    debts_to_financial_institutions: 'Debts to Financial Institutions',
};

function fmtFull(v: number | null | undefined): string {
    if (v === null || v === undefined) return '';
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function EditFinancials({ statementId, companyName, onBack }: Props) {
    const [stmt, setStmt] = useState<FinancialStatement | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Track edits: key = "line_{id}" or "metric_{name}"
    const [editValues, setEditValues] = useState<Record<string, string>>({});
    const [editComments, setEditComments] = useState<Record<string, string>>({});
    const [globalComment, setGlobalComment] = useState('');

    useEffect(() => {
        setLoading(true);
        fetchFinancialStatement(statementId)
            .then(s => { setStmt(s); setLoading(false); })
            .catch(e => { setError(e.message); setLoading(false); });
    }, [statementId]);

    const pendingEdits = useMemo(() => {
        if (!stmt) return [];
        const edits: PendingEdit[] = [];

        // Check line item edits
        for (const item of stmt.line_items) {
            const key = `line_${item.id}`;
            const newValStr = editValues[key];
            if (newValStr !== undefined && newValStr !== '') {
                const newVal = parseFloat(newValStr);
                if (!isNaN(newVal) && newVal !== item.value_reported) {
                    edits.push({
                        lineItemId: item.id,
                        itemLabel: `${item.category}: ${item.item_name}`,
                        oldValue: item.value_reported || 0,
                        newValue: newVal,
                        comment: editComments[key] || globalComment || '',
                    });
                }
            }
        }

        // Check metric edits
        for (const [name, label] of Object.entries(METRIC_LABELS)) {
            const key = `metric_${name}`;
            const newValStr = editValues[key];
            if (newValStr !== undefined && newValStr !== '') {
                const newVal = parseFloat(newValStr);
                const oldVal = stmt.metrics[name] || 0;
                if (!isNaN(newVal) && newVal !== oldVal) {
                    edits.push({
                        metricName: name,
                        itemLabel: label,
                        oldValue: oldVal,
                        newValue: newVal,
                        comment: editComments[key] || globalComment || '',
                    });
                }
            }
        }

        return edits;
    }, [stmt, editValues, editComments, globalComment]);

    const hasEmptyComments = pendingEdits.some(e => !e.comment.trim());

    const handleSave = async () => {
        if (pendingEdits.length === 0) {
            onBack();
            return;
        }
        if (hasEmptyComments) {
            setError('All changes require a comment explaining the reason for the change.');
            return;
        }

        setSaving(true);
        setError('');
        try {
            await bulkEditFinancials(
                statementId,
                pendingEdits.map(e => ({
                    line_item_id: e.lineItemId || null,
                    metric_name: e.metricName || null,
                    old_value: e.oldValue,
                    new_value: e.newValue,
                    comment: e.comment,
                }))
            );
            onBack();
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center py-32">
                <svg className="animate-spin h-8 w-8 text-teal-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
            </div>
        );
    }

    if (!stmt) {
        return <div className="text-center py-20 text-red-500">Failed to load financial statement.</div>;
    }

    const assets = stmt.line_items.filter(i => i.category === 'Asset' && !i.is_total);
    const liabilities = stmt.line_items.filter(i => i.category === 'Liability' && !i.is_total);
    const equities = stmt.line_items.filter(i => i.category === 'Equity' && !i.is_total);
    const incomeItems = stmt.line_items.filter(i => i.category === 'Income' && !i.is_total);

    return (
        <div className="max-w-6xl mx-auto">
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
                        <h1 className="text-2xl font-extrabold text-gray-900">Edit Financial Metrics</h1>
                        <p className="text-sm text-gray-500 mt-0.5">
                            {companyName} — {stmt.year} ({stmt.currency || 'USD'})
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
                        className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
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
                    placeholder="e.g., Corrected values based on audited financial statements Q4 2024"
                    className="w-full px-3 py-2 border border-blue-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300"
                    rows={2}
                />
            </div>

            {/* ── Top-Level Metrics ── */}
            <EditSection title="Key Financial Metrics">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Object.entries(METRIC_LABELS).map(([name, label]) => (
                        <MetricEditField
                            key={name}
                            fieldKey={`metric_${name}`}
                            label={label}
                            currentValue={stmt.metrics[name]}
                            editValues={editValues}
                            editComments={editComments}
                            onValueChange={(k, v) => setEditValues(prev => ({ ...prev, [k]: v }))}
                            onCommentChange={(k, v) => setEditComments(prev => ({ ...prev, [k]: v }))}
                        />
                    ))}
                </div>
            </EditSection>

            {/* ── Asset Line Items ── */}
            <EditSection title="Asset Line Items">
                <LineItemEditTable items={assets} editValues={editValues} editComments={editComments}
                    onValueChange={(k, v) => setEditValues(prev => ({ ...prev, [k]: v }))}
                    onCommentChange={(k, v) => setEditComments(prev => ({ ...prev, [k]: v }))}
                />
            </EditSection>

            {/* ── Liability Line Items ── */}
            <EditSection title="Liability Line Items">
                <LineItemEditTable items={liabilities} editValues={editValues} editComments={editComments}
                    onValueChange={(k, v) => setEditValues(prev => ({ ...prev, [k]: v }))}
                    onCommentChange={(k, v) => setEditComments(prev => ({ ...prev, [k]: v }))}
                />
            </EditSection>

            {/* ── Equity Line Items ── */}
            <EditSection title="Equity Line Items">
                <LineItemEditTable items={equities} editValues={editValues} editComments={editComments}
                    onValueChange={(k, v) => setEditValues(prev => ({ ...prev, [k]: v }))}
                    onCommentChange={(k, v) => setEditComments(prev => ({ ...prev, [k]: v }))}
                />
            </EditSection>

            {/* ── Income Statement Line Items ── */}
            <EditSection title="Income Statement Line Items">
                <LineItemEditTable items={incomeItems} editValues={editValues} editComments={editComments}
                    onValueChange={(k, v) => setEditValues(prev => ({ ...prev, [k]: v }))}
                    onCommentChange={(k, v) => setEditComments(prev => ({ ...prev, [k]: v }))}
                />
            </EditSection>

            {/* ── Pending Changes Summary ── */}
            {pendingEdits.length > 0 && (
                <div className="mt-8 mb-12">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">Pending Changes Summary</h3>
                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-amber-50 border-b border-amber-100">
                                    <th className="text-left px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Field</th>
                                    <th className="text-right px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Current</th>
                                    <th className="text-right px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">New Value</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Comment</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {pendingEdits.map((e, i) => (
                                    <tr key={i} className={!e.comment.trim() ? 'bg-red-50/50' : ''}>
                                        <td className="px-4 py-2 text-gray-700 font-medium">{e.itemLabel}</td>
                                        <td className="px-4 py-2 text-right text-gray-500 tabular-nums">{fmtFull(e.oldValue)}</td>
                                        <td className="px-4 py-2 text-right text-teal-700 font-semibold tabular-nums">{fmtFull(e.newValue)}</td>
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

            {/* Bottom Save Button */}
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
                    className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-300 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm"
                >
                    <Save size={14} />
                    {saving ? 'Saving...' : pendingEdits.length > 0 ? `Save ${pendingEdits.length} Change${pendingEdits.length !== 1 ? 's' : ''} & Return` : 'Return'}
                </button>
            </div>
        </div>
    );
}

/* ── Sub-components ── */

function EditSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="mb-8">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-1 h-6 bg-teal-500 rounded-full" />
                <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            </div>
            {children}
        </div>
    );
}

function MetricEditField({
    fieldKey, label, currentValue, editValues, editComments, onValueChange, onCommentChange
}: {
    fieldKey: string;
    label: string;
    currentValue: number | undefined;
    editValues: Record<string, string>;
    editComments: Record<string, string>;
    onValueChange: (key: string, val: string) => void;
    onCommentChange: (key: string, val: string) => void;
}) {
    const editVal = editValues[fieldKey];
    const isChanged = editVal !== undefined && editVal !== '' && parseFloat(editVal) !== (currentValue || 0);

    return (
        <div className={`bg-white rounded-xl border p-4 transition-colors ${isChanged ? 'border-amber-300 bg-amber-50/30' : 'border-gray-100'}`}>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</label>
            <div className="text-xs text-gray-500 mb-2">Current: {fmtFull(currentValue)}</div>
            <input
                type="number"
                step="any"
                placeholder={currentValue != null ? String(currentValue) : '0'}
                value={editVal || ''}
                onChange={e => onValueChange(fieldKey, e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-300 tabular-nums"
            />
            {isChanged && (
                <textarea
                    placeholder="Reason for change (required)"
                    value={editComments[fieldKey] || ''}
                    onChange={e => onCommentChange(fieldKey, e.target.value)}
                    className="w-full mt-2 px-3 py-2 border border-amber-200 rounded-lg text-xs bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-300"
                    rows={2}
                />
            )}
        </div>
    );
}

function LineItemEditTable({
    items, editValues, editComments, onValueChange, onCommentChange
}: {
    items: FinancialLineItem[];
    editValues: Record<string, string>;
    editComments: Record<string, string>;
    onValueChange: (key: string, val: string) => void;
    onCommentChange: (key: string, val: string) => void;
}) {
    return (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
                <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase w-1/3">Line Item</th>
                        <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase">Current Value</th>
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase">New Value</th>
                        <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase">Comment</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {items.map(item => {
                        const key = `line_${item.id}`;
                        const editVal = editValues[key];
                        const isChanged = editVal !== undefined && editVal !== '' && parseFloat(editVal) !== (item.value_reported || 0);

                        return (
                            <tr key={item.id} className={`transition-colors ${isChanged ? 'bg-amber-50/50' : 'hover:bg-gray-50/50'}`}>
                                <td className="px-4 py-2.5 text-gray-700 font-medium text-[13px]">{item.item_name}</td>
                                <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{fmtFull(item.value_reported)}</td>
                                <td className="px-4 py-2.5">
                                    <input
                                        type="number"
                                        step="any"
                                        placeholder={item.value_reported != null ? String(item.value_reported) : '0'}
                                        value={editVal || ''}
                                        onChange={e => onValueChange(key, e.target.value)}
                                        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-300 tabular-nums"
                                    />
                                </td>
                                <td className="px-4 py-2.5">
                                    {isChanged && (
                                        <input
                                            type="text"
                                            placeholder="Reason..."
                                            value={editComments[key] || ''}
                                            onChange={e => onCommentChange(key, e.target.value)}
                                            className="w-full px-2 py-1.5 border border-amber-200 rounded-lg text-xs bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-300"
                                        />
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
