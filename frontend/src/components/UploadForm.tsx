import React, { useState } from 'react';
import { Upload, AlertCircle } from 'lucide-react';

interface UploadFormProps {
    onSubmit: (companyName: string, files: File[]) => Promise<void>;
    onCancel: () => void;
    loading: boolean;
    error: string;
}

export default function UploadForm({ onSubmit, onCancel, loading, error }: UploadFormProps) {
    const [companyName, setCompanyName] = useState('');
    const [files, setFiles] = useState<File[]>([]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await onSubmit(companyName, files);
    };

    return (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-2xl p-8 max-w-xl mx-auto mt-16 shadow-xl">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Analyze Target Company</h2>
                <button type="button" onClick={onCancel} className="text-gray-400 hover:text-gray-700 font-medium text-sm">Cancel</button>
            </div>

            <div className="mb-5">
                <label className="block text-sm font-medium text-gray-600 mb-2">Company Name</label>
                <input
                    type="text"
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-gray-50/50"
                    placeholder="e.g. Baobab Group"
                    required
                />
            </div>

            <div className="mb-6">
                <label className="block text-sm font-medium text-gray-600 mb-2">Upload Files</label>
                <div className="relative border-2 border-dashed border-gray-200 rounded-xl p-8 text-center hover:border-blue-400 transition-colors bg-gray-50/30">
                    <input
                        type="file"
                        multiple
                        accept=".pdf,.pptx,.xls,.xlsx,.csv"
                        onChange={e => setFiles(e.target.files ? Array.from(e.target.files) : [])}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Upload className="mx-auto h-7 w-7 text-gray-300 mb-2" />
                    <p className="text-sm text-gray-400">Drag & drop files here or click to browse</p>
                    <p className="text-xs text-gray-300 mt-1">PDF, PPTX, Excel, CSV</p>
                    {files.length > 0 && (
                        <div className="mt-3 text-xs text-blue-500 font-semibold">{files.length} file(s) selected</div>
                    )}
                </div>
            </div>

            {error && (
                <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start text-red-600 text-sm">
                    <AlertCircle size={14} className="mr-2 mt-0.5 shrink-0" />
                    {error}
                </div>
            )}

            <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors flex justify-center items-center disabled:opacity-60"
            >
                {loading ? (
                    <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Processing AI Extraction...
                    </span>
                ) : 'Run Analysis'}
            </button>
        </form>
    );
}
