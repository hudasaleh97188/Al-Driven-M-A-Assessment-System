import { ShieldAlert } from 'lucide-react';
import type { AnalysisData } from '../types';

export default function RatingComparison({ data }: { data: AnalysisData }) {
    const geo = data.macroeconomic_geo_view ?? [];

    if (geo.length === 0) {
        return (
            <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center min-h-[400px] text-center border border-dashed border-gray-200 rounded-2xl bg-gray-50/50 p-8">
                <ShieldAlert className="w-12 h-12 text-gray-300 mb-4" />
                <h2 className="text-xl font-bold text-gray-900 mb-2">Macroeconomic Data Missing</h2>
                <p className="text-gray-500 text-sm max-w-sm mx-auto">
                    The macroeconomic and country rating data is currently unavailable. Please re-analyze the report to trigger the Stage 3 Macroeconomic sweep.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
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
                            {geo.map(g => (
                                <tr key={g.country} className="hover:bg-gray-50/50 transition-colors">
                                    <td className="px-4 py-3 whitespace-nowrap">
                                        <div className="font-bold text-gray-900 text-[13px]">{g.country}</div>
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">
                                        {g.population || 'N/A'}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">
                                        {g.gdp_per_capita_ppp || 'N/A'}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">
                                        {g.gdp_growth_forecast || 'N/A'}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium max-w-[100px] truncate">
                                        {g.inflation || 'N/A'}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">
                                        {g.central_bank_interest_rate || 'N/A'}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">
                                        {g.unemployment_rate || 'N/A'}
                                    </td>
                                    <td className="px-4 py-3 text-[13px] text-gray-600 font-medium max-w-[140px] truncate">
                                        {g.country_risk_rating || 'N/A'}
                                    </td>
                                    <td className="px-4 py-3 whitespace-nowrap text-[13px] text-gray-600 font-medium">
                                        {g.corruption_perceptions_index_rank || 'N/A'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}

