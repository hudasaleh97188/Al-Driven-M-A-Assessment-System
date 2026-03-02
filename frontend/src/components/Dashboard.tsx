import { Plus } from 'lucide-react';
import type { AnalysisListItem } from '../types';

interface DashboardProps {
    history: AnalysisListItem[];
    onNewDocument: () => void;
    onSelectCompany: (name: string) => void;
}

export default function Dashboard({ history, onNewDocument, onSelectCompany }: DashboardProps) {
    return (
        <div className="animate-in fade-in duration-500">
            <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Your Analyses</h2>
                <p className="text-gray-400 text-sm">Select a company to view its due diligence report, or upload new annual reports.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {/* Add New */}
                <div
                    onClick={onNewDocument}
                    className="bg-emerald-50/40 hover:bg-emerald-50/80 border-2 border-dashed border-emerald-300 rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all min-h-[180px] hover:border-emerald-400"
                >
                    <div className="bg-emerald-500 text-white rounded-full p-3 mb-3 shadow-lg shadow-emerald-500/20">
                        <Plus size={22} strokeWidth={3} />
                    </div>
                    <span className="text-emerald-600 font-semibold text-sm">New Analysis</span>
                </div>

                {/* History */}
                {history.map((item, idx) => (
                    <div
                        key={idx}
                        onClick={() => onSelectCompany(item.company_name)}
                        className="bg-white border border-gray-200 hover:border-blue-300 rounded-2xl p-6 flex flex-col justify-between cursor-pointer transition-all hover:shadow-lg min-h-[180px] group"
                    >
                        <div className="flex justify-between items-start">
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full uppercase tracking-wider">
                                Analyzed
                            </span>
                            <span className="text-[11px] text-gray-400 font-medium">
                                {item.analyzed_at ? new Date(item.analyzed_at).toLocaleDateString('en-GB') : '—'}
                            </span>
                        </div>
                        <div className="text-center my-auto py-4">
                            <h3 className="text-lg font-bold text-gray-900 capitalize">{item.company_name}</h3>
                        </div>
                        <div className="flex justify-end text-gray-300 group-hover:text-blue-500 transition-colors">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
