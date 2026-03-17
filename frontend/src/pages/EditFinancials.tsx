import { useState, useEffect, useMemo } from 'react';
import { Save, ArrowLeft, AlertCircle, Plus, Trash2, X } from 'lucide-react';
import { fetchFinancialStatement, bulkEditFinancials } from '../api';
import type { FinancialStatement, FinancialLineItem } from '../types';

interface Props {
    statementId: number;
    companyName: string;
    allStatements: FinancialStatement[];
    onBack: () => void;
}

interface PendingEdit {
    lineItemId?: number | null;
    metricName?: string | null;
    operation: 'UPDATE' | 'ADD' | 'DELETE';
    itemLabel: string;
    category?: 'Asset' | 'Liability' | 'Equity' | 'Income';
    itemName?: string;
    oldValue: number;
    newValue: number;
    comment: string;
}

interface NewItem {
    tempId: string;
    category: 'Asset' | 'Liability' | 'Equity' | 'Income';
    name: string;
    value: string;
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

export default function EditFinancials({ statementId, companyName, allStatements, onBack }: Props) {
    const [currentStatementId, setCurrentStatementId] = useState(statementId);
    const [stmt, setStmt] = useState<FinancialStatement | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Track edits: key = "line_{id}" or "metric_{name}"
    const [editValues, setEditValues] = useState<Record<string, string>>({});
    const [editComments, setEditComments] = useState<Record<string, string>>({});
    const [deletedItemIds, setDeletedItemIds] = useState<Set<number>>(new Set());
    const [newItems, setNewItems] = useState<NewItem[]>([]);
    const [globalComment, setGlobalComment] = useState('');

    useEffect(() => {
        setLoading(true);
        fetchFinancialStatement(currentStatementId)
            .then(s => { 
                setStmt(s); 
                setLoading(false);
                // Reset edits when switching years to avoid confusion
                setEditValues({});
                setEditComments({});
                setDeletedItemIds(new Set());
                setNewItems([]);
                setGlobalComment('');
                setError('');
            })
            .catch(e => { setError(e.message); setLoading(false); });
    }, [currentStatementId]);

    const pendingEdits = useMemo(() => {
        if (!stmt) return [];
        const edits: PendingEdit[] = [];

        // 1. Check line item updates
        for (const item of stmt.line_items) {
            if (deletedItemIds.has(item.id)) continue;

            const key = `line_${item.id}`;
            const newValStr = editValues[key];
            if (newValStr !== undefined && newValStr !== '') {
                const newVal = parseFloat(newValStr);
                if (!isNaN(newVal) && newVal !== item.value_reported) {
                    edits.push({
                        lineItemId: item.id,
                        operation: 'UPDATE',
                        itemLabel: `${item.category}: ${item.item_name}`,
                        oldValue: item.value_reported || 0,
                        newValue: newVal,
                        comment: editComments[key] || globalComment || '',
                    });
                }
            }
        }

        // 2. Check metric updates
        for (const [name, label] of Object.entries(METRIC_LABELS)) {
            const key = `metric_${name}`;
            const newValStr = editValues[key];
            if (newValStr !== undefined && newValStr !== '') {
                const newVal = parseFloat(newValStr);
                const oldVal = stmt.metrics[name] || 0;
                if (!isNaN(newVal) && newVal !== oldVal) {
                    edits.push({
                        metricName: name,
                        operation: 'UPDATE',
                        itemLabel: label,
                        oldValue: oldVal,
                        newValue: newVal,
                        comment: editComments[key] || globalComment || '',
                    });
                }
            }
        }

        // 3. Deletions
        for (const itemId of deletedItemIds) {
            const item = stmt.line_items.find(i => i.id === itemId);
            if (item) {
                edits.push({
                    lineItemId: item.id,
                    operation: 'DELETE',
                    itemLabel: `DELETE: ${item.category}: ${item.item_name}`,
                    oldValue: item.value_reported || 0,
                    newValue: 0,
                    comment: editComments[`del_${item.id}`] || globalComment || '',
                });
            }
        }

        // 4. Additions
        for (const ni of newItems) {
            if (!ni.name.trim()) continue;
            const val = parseFloat(ni.value) || 0;
            edits.push({
                operation: 'ADD',
                category: ni.category,
                itemName: ni.name,
                itemLabel: `ADD: ${ni.category}: ${ni.name}`,
                oldValue: 0,
                newValue: val,
                comment: ni.comment || globalComment || '',
            });
        }

        return edits;
    }, [stmt, editValues, editComments, globalComment, deletedItemIds, newItems]);

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
                currentStatementId,
                pendingEdits.map(e => ({
                    line_item_id: e.lineItemId || null,
                    metric_name: e.metricName || null,
                    operation: e.operation,
                    item_name: e.itemName || null,
                    category: e.category || null,
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

    const handleAddItem = (category: 'Asset' | 'Liability' | 'Equity' | 'Income') => {
        setNewItems(prev => [...prev, {
            tempId: Math.random().toString(36).substr(2, 9),
            category,
            name: '',
            value: '',
            comment: ''
        }]);
    };

    const handleRemoveNewItem = (tempId: string) => {
        setNewItems(prev => prev.filter(ni => ni.tempId !== tempId));
    };

    const handleUpdateNewItem = (tempId: string, field: keyof NewItem, val: string) => {
        setNewItems(prev => prev.map(ni => ni.tempId === tempId ? { ...ni, [field]: val } : ni));
    };

    const handleDeleteLineItem = (id: number) => {
        setDeletedItemIds(prev => new Set(prev).add(id));
    };

    const handleRestoreLineItem = (id: number) => {
        setDeletedItemIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    return (
        <div className="max-w-6xl mx-auto pb-20">
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
                        <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-sm text-gray-500">{companyName} — </span>
                            <select
                                value={currentStatementId}
                                onChange={(e) => {
                                    if (pendingEdits.length > 0) {
                                        if (!window.confirm('You have unsaved changes. Switching years will discard them. Continue?')) return;
                                    }
                                    setCurrentStatementId(Number(e.target.value));
                                }}
                                className="text-sm font-bold text-teal-600 bg-teal-50 border-none rounded-md px-2 py-0.5 focus:ring-2 focus:ring-teal-500 cursor-pointer"
                            >
                                {allStatements.sort((a, b) => b.year - a.year).map(s => (
                                    <option key={s.id} value={s.id}>{s.year}</option>
                                ))}
                            </select>
                            <span className="text-sm text-gray-500 ml-1">({stmt.currency || 'USD'})</span>
                        </div>
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
            <EditSection title="Asset Line Items" onAdd={() => handleAddItem('Asset')}>
                <LineItemEditTable 
                    items={assets} 
                    newItems={newItems.filter(ni => ni.category === 'Asset')}
                    editValues={editValues} 
                    editComments={editComments}
                    onValueChange={(k, v) => setEditValues(prev => ({ ...prev, [k]: v }))}
                    onCommentChange={(k, v) => setEditComments(prev => ({ ...prev, [k]: v }))}
                    onDelete={handleDeleteLineItem}
                    onRestore={handleRestoreLineItem}
                    deletedItemIds={deletedItemIds}
                    onUpdateNewItem={handleUpdateNewItem}
                    onRemoveNewItem={handleRemoveNewItem}
                />
            </EditSection>

            {/* ── Liability Line Items ── */}
            <EditSection title="Liability Line Items" onAdd={() => handleAddItem('Liability')}>
                <LineItemEditTable 
                    items={liabilities} 
                    newItems={newItems.filter(ni => ni.category === 'Liability')}
                    editValues={editValues} 
                    editComments={editComments}
                    onValueChange={(k, v) => setEditValues(prev => ({ ...prev, [k]: v }))}
                    onCommentChange={(k, v) => setEditComments(prev => ({ ...prev, [k]: v }))}
                    onDelete={handleDeleteLineItem}
                    onRestore={handleRestoreLineItem}
                    deletedItemIds={deletedItemIds}
                    onUpdateNewItem={handleUpdateNewItem}
                    onRemoveNewItem={handleRemoveNewItem}
                />
            </EditSection>

            {/* ── Equity Line Items ── */}
            <EditSection title="Equity Line Items" onAdd={() => handleAddItem('Equity')}>
                <LineItemEditTable 
                    items={equities} 
                    newItems={newItems.filter(ni => ni.category === 'Equity')}
                    editValues={editValues} 
                    editComments={editComments}
                    onValueChange={(k, v) => setEditValues(prev => ({ ...prev, [k]: v }))}
                    onCommentChange={(k, v) => setEditComments(prev => ({ ...prev, [k]: v }))}
                    onDelete={handleDeleteLineItem}
                    onRestore={handleRestoreLineItem}
                    deletedItemIds={deletedItemIds}
                    onUpdateNewItem={handleUpdateNewItem}
                    onRemoveNewItem={handleRemoveNewItem}
                />
            </EditSection>

            {/* ── Income Statement Line Items ── */}
            <EditSection title="Income Statement Line Items" onAdd={() => handleAddItem('Income')}>
                <LineItemEditTable 
                    items={incomeItems} 
                    newItems={newItems.filter(ni => ni.category === 'Income')}
                    editValues={editValues} 
                    editComments={editComments}
                    onValueChange={(k, v) => setEditValues(prev => ({ ...prev, [k]: v }))}
                    onCommentChange={(k, v) => setEditComments(prev => ({ ...prev, [k]: v }))}
                    onDelete={handleDeleteLineItem}
                    onRestore={handleRestoreLineItem}
                    deletedItemIds={deletedItemIds}
                    onUpdateNewItem={handleUpdateNewItem}
                    onRemoveNewItem={handleRemoveNewItem}
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
                                    <th className="text-left px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Operation</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Field</th>
                                    <th className="text-right px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Current</th>
                                    <th className="text-right px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">New Value</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-bold text-amber-800 uppercase">Comment</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {pendingEdits.map((e, i) => (
                                    <tr key={i} className={!e.comment.trim() ? 'bg-red-50/50' : ''}>
                                        <td className="px-4 py-2">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                e.operation === 'ADD' ? 'bg-green-100 text-green-700' : 
                                                e.operation === 'DELETE' ? 'bg-red-100 text-red-700' : 
                                                'bg-blue-100 text-blue-700'
                                            }`}>
                                                {e.operation}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-gray-700 font-medium">{e.itemLabel}</td>
                                        <td className="px-4 py-2 text-right text-gray-500 tabular-nums">{e.operation === 'ADD' ? '-' : fmtFull(e.oldValue)}</td>
                                        <td className="px-4 py-2 text-right text-teal-700 font-semibold tabular-nums">
                                            {e.operation === 'DELETE' ? <span className="text-red-500 italic">Deleted</span> : fmtFull(e.newValue)}
                                        </td>
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

            {/* ── Edit History (Moved here) ── */}
            {stmt.edit_history && stmt.edit_history.length > 0 && (
                <div className="mt-12 border-t border-gray-100 pt-12">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">Edit History for {stmt.year}</h3>
                    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-gray-50 border-b border-gray-100">
                                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase font-sans">Op</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase font-sans">Field</th>
                                    <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase font-sans">Old Value</th>
                                    <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase font-sans">New Value</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase font-sans">Comment</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase font-sans">User</th>
                                    <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-400 uppercase font-sans">Date</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                                {stmt.edit_history.map(edit => (
                                    <tr key={edit.id} className="hover:bg-gray-50/50">
                                        <td className="px-4 py-2">
                                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                                edit.operation === 'ADD' ? 'bg-green-50 text-green-600' : 
                                                edit.operation === 'DELETE' ? 'bg-red-50 text-red-600' : 
                                                'bg-blue-50 text-blue-600'
                                            }`}>
                                                {edit.operation || 'UPD'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2 text-gray-700 font-medium">
                                            {edit.metric_name || edit.item_name || `Item #${edit.line_item_id}`}
                                        </td>
                                        <td className="px-4 py-2 text-right text-gray-500 tabular-nums">{edit.operation === 'ADD' ? '-' : fmtFull(edit.old_value)}</td>
                                        <td className="px-4 py-2 text-right text-gray-900 font-semibold tabular-nums">
                                            {edit.operation === 'DELETE' ? <span className="text-red-500 italic">Deleted</span> : fmtFull(edit.new_value)}
                                        </td>
                                        <td className="px-4 py-2 text-gray-600 max-w-xs truncate">{edit.comment}</td>
                                        <td className="px-4 py-2 text-gray-500">{edit.username || 'N/A'}</td>
                                        <td className="px-4 py-2 text-gray-400 text-xs">{edit.edited_at}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Bottom Save Button */}
            <div className="sticky bottom-0 bg-white/90 backdrop-blur-sm border-t border-gray-100 py-4 -mx-6 px-6 flex justify-end gap-3 z-10 mt-8">
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

function EditSection({ title, children, onAdd }: { title: string; children: React.ReactNode; onAdd?: () => void }) {
    return (
        <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="w-1 h-6 bg-teal-500 rounded-full" />
                    <h3 className="text-lg font-bold text-gray-900">{title}</h3>
                </div>
                {onAdd && (
                    <button
                        onClick={onAdd}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 text-teal-700 hover:bg-teal-100 rounded-lg text-xs font-bold transition-colors"
                    >
                        <Plus size={14} />
                        Add New Item
                    </button>
                )}
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
    items, newItems, editValues, editComments, onValueChange, onCommentChange, onDelete, onRestore, deletedItemIds, onUpdateNewItem, onRemoveNewItem
}: {
    items: FinancialLineItem[];
    newItems: NewItem[];
    editValues: Record<string, string>;
    editComments: Record<string, string>;
    onValueChange: (key: string, val: string) => void;
    onCommentChange: (key: string, val: string) => void;
    onDelete: (id: number) => void;
    onRestore: (id: number) => void;
    deletedItemIds: Set<number>;
    onUpdateNewItem: (tempId: string, field: keyof NewItem, val: string) => void;
    onRemoveNewItem: (tempId: string) => void;
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
                        <th className="px-4 py-2.5 w-10"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {items.map(item => {
                        const key = `line_${item.id}`;
                        const editVal = editValues[key];
                        const isDeleted = deletedItemIds.has(item.id);
                        const isChanged = !isDeleted && editVal !== undefined && editVal !== '' && parseFloat(editVal) !== (item.value_reported || 0);

                        return (
                            <tr key={item.id} className={`transition-colors ${isDeleted ? 'bg-red-50/30' : isChanged ? 'bg-amber-50/50' : 'hover:bg-gray-50/50'}`}>
                                <td className={`px-4 py-2.5 text-gray-700 font-medium text-[13px] ${isDeleted ? 'line-through text-gray-400' : ''}`}>
                                    {item.item_name}
                                </td>
                                <td className={`px-4 py-2.5 text-right text-gray-500 tabular-nums ${isDeleted ? 'text-gray-300' : ''}`}>
                                    {fmtFull(item.value_reported)}
                                </td>
                                <td className="px-4 py-2.5">
                                    {!isDeleted && (
                                        <input
                                            type="number"
                                            step="any"
                                            placeholder={item.value_reported != null ? String(item.value_reported) : '0'}
                                            value={editVal || ''}
                                            onChange={e => onValueChange(key, e.target.value)}
                                            className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-300 tabular-nums"
                                        />
                                    )}
                                    {isDeleted && <span className="text-red-500 text-xs font-bold italic px-2">Marked for Deletion</span>}
                                </td>
                                <td className="px-4 py-2.5">
                                    {(isChanged || isDeleted) && (
                                        <input
                                            type="text"
                                            placeholder={isDeleted ? "Reason for deletion..." : "Reason for change..."}
                                            value={editComments[isDeleted ? `del_${item.id}` : key] || ''}
                                            onChange={e => onCommentChange(isDeleted ? `del_${item.id}` : key, e.target.value)}
                                            className={`w-full px-2 py-1.5 border rounded-lg text-xs focus:outline-none focus:ring-2 ${
                                                isDeleted ? 'border-red-200 bg-red-50 focus:ring-red-300' : 'border-amber-200 bg-amber-50 focus:ring-amber-300'
                                            }`}
                                        />
                                    )}
                                </td>
                                <td className="px-4 py-2.5 text-center">
                                    {isDeleted ? (
                                        <button
                                            onClick={() => onRestore(item.id)}
                                            className="p-1.5 text-teal-600 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition-colors"
                                            title="Restore Item"
                                        >
                                            <ArrowLeft size={14} />
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => onDelete(item.id)}
                                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                            title="Delete Item"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                    {newItems.map(ni => (
                        <tr key={ni.tempId} className="bg-green-50/30 animate-in fade-in slide-in-from-left-2 duration-300">
                            <td className="px-4 py-2.5">
                                <input
                                    type="text"
                                    placeholder="Item name (e.g. Other Assets)"
                                    value={ni.name}
                                    onChange={e => onUpdateNewItem(ni.tempId, 'name', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-green-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-green-300 bg-white"
                                />
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-400 italic text-xs">New Item</td>
                            <td className="px-4 py-2.5">
                                <input
                                    type="number"
                                    step="any"
                                    placeholder="Value"
                                    value={ni.value}
                                    onChange={e => onUpdateNewItem(ni.tempId, 'value', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-green-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-green-300 bg-white tabular-nums"
                                />
                            </td>
                            <td className="px-4 py-2.5">
                                <input
                                    type="text"
                                    placeholder="Reason for adding..."
                                    value={ni.comment}
                                    onChange={e => onUpdateNewItem(ni.tempId, 'comment', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-green-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-300"
                                />
                            </td>
                            <td className="px-4 py-2.5 text-center">
                                <button
                                    onClick={() => onRemoveNewItem(ni.tempId)}
                                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Remove"
                                >
                                    <X size={14} />
                                </button>
                            </td>
                        </tr>
                    ))}
                    {items.length === 0 && newItems.length === 0 && (
                        <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-gray-400 italic">No items in this category.</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
