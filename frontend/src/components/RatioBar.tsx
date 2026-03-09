export default function RatioBar({ ratio, badge }: { ratio: number | string; badge?: React.ReactNode }) {
    const numRatio = typeof ratio === 'string' ? parseFloat(ratio.replace(/[^0-9.-]+/g, '')) : (ratio ?? 0);
    const validRatio = isNaN(numRatio) ? 0 : numRatio;
    const fillPct = Math.min(100, Math.max(0, (validRatio / 2) * 100));
    const barColor = validRatio < 1.0 ? 'bg-orange-500' : 'bg-blue-500';

    return (
        <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100/80 hover:shadow-md transition-shadow duration-300 relative">
            {badge && <div className="absolute top-2 right-2">{badge}</div>}
            <h3 className="text-gray-400 uppercase tracking-wider text-[11px] font-semibold mb-2">Deposits vs Borrowings</h3>
            <div className="text-2xl font-bold text-gray-900 tracking-tight mb-3">{validRatio.toFixed(2)}x</div>

            <div className="relative h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                <div style={{ width: `${fillPct}%` }} className={`${barColor} h-full transition-all duration-500`} />
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white z-10 -translate-x-1/2" />
            </div>
            <div className="flex justify-between mt-1.5 text-[10px] font-medium text-gray-400">
                <span>Wholesale</span>
                <span>1.0x Neutral</span>
                <span>Depositor</span>
            </div>
        </div>
    );
}
