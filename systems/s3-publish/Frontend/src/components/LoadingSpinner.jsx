import React from 'react';
import { Loader2 } from 'lucide-react';

export default function LoadingSpinner({ text = 'Loading data...' }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-slate-400">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-3" />
      <p className="text-sm font-medium">{text}</p>
    </div>
  );
}
