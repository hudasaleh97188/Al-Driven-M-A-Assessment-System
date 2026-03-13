import React, { useState } from 'react';
import { useAuth, Role } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<Role>('viewer');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      login(username, role);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-blue-900/20 blur-3xl"></div>
        <div className="absolute top-40 -left-40 w-96 h-96 rounded-full bg-emerald-900/20 blur-3xl"></div>
      </div>
      
      <div className="relative w-full max-w-md bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl p-8 z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-bold text-xl mb-4 shadow-lg shadow-blue-500/25">
            D
          </div>
          <h1 className="text-3xl font-display font-bold text-white tracking-tight">DealLens</h1>
          <p className="text-slate-400 mt-2 font-light">M&A Assessment System</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Username</label>
            <input 
              type="text" 
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              placeholder="Enter your username"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Role simulation</label>
            <div className="grid grid-cols-3 gap-3">
              {(['viewer', 'reviewer', 'admin'] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    role === r 
                      ? 'bg-blue-600 outline-none text-white shadow-md shadow-blue-500/25' 
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <span className="capitalize">{r}</span>
                </button>
              ))}
            </div>
          </div>

          <button 
            type="submit"
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-lg px-4 py-3 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 transform hover:-translate-y-0.5 transition-all outline-none"
          >
            Authenticate
          </button>
        </form>
      </div>
    </div>
  );
}
