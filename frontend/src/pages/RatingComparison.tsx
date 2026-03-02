export default function RatingComparison() {
    return (
        <div className="animate-in fade-in duration-500 flex flex-col items-center justify-center min-h-[400px] text-center">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-5">
                <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Rating & Peer Comparison</h2>
            <p className="text-gray-400 text-sm max-w-md">
                This section will display peer benchmarking, rating methodologies, and comparative analysis against industry peers. Coming soon.
            </p>
            <div className="mt-6 px-4 py-2 bg-gray-100 rounded-full text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Coming Soon
            </div>
        </div>
    );
}
