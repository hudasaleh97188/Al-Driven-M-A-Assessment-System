import React from 'react';

export default function Layout({ children }: { children: React.ReactNode }) {
  const goHome = () => { window.location.href = '/' };
  
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-900">
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
              <div className="flex items-center gap-3 cursor-pointer" onClick={goHome}>
                  <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-lg shadow-blue-500/20">D</div>
                  <span className="text-base font-bold tracking-wide text-gray-900">DealLens</span>
              </div>
          </div>
      </header>
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  );
}
