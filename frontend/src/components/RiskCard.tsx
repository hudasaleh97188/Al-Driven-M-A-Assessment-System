import { FileText, DollarSign } from 'lucide-react';
import type { AnomalyRisk } from '../types';

const severityColor: Record<string, string> = {
    critical: 'bg-red-100 text-red-700 border-red-200',
    high: 'bg-orange-100 text-orange-700 border-orange-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

export default function RiskCard({ risk }: { risk: AnomalyRisk }) {
    const badge = severityColor[risk.severity_level?.toLowerCase()] ?? 'bg-gray-100 text-gray-600 border-gray-200';

    return (
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow duration-300">
            {/* Header */}
            <div className="flex items-center gap-2.5 mb-3">
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider border ${badge}`}>
                    {risk.severity_level}
                </span>
                <span className="text-gray-400 text-[11px] font-semibold uppercase tracking-wider truncate">{risk.category}</span>
            </div>

            {/* Description */}
            <p className="text-gray-600 text-sm leading-relaxed mb-4">{risk.description}</p>

            {/* Two sub-cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-100">
                    <div className="flex items-start text-sm text-gray-700 leading-relaxed">
                        <DollarSign className="w-3.5 h-3.5 mr-2 mt-0.5 flex-shrink-0 text-blue-500" />
                        <span>{risk.valuation_impact || 'N/A'}</span>
                    </div>
                </div>
                <div className="bg-blue-50/50 p-3.5 rounded-xl border border-blue-100/50">
                    <div className="flex items-start text-sm text-gray-700 leading-relaxed">
                        <FileText className="w-3.5 h-3.5 mr-2 mt-0.5 flex-shrink-0 text-blue-500" />
                        <span>{risk.negotiation_leverage || 'N/A'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
