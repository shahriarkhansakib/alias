import React from 'react';
import { Inbox } from 'lucide-react';

export default function EmptyState({ 
  title = 'No data available yet.', 
  description = 'Create your first post or adjust filters to view social metrics.',
  actionButton = null 
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center p-12 glass-panel rounded-2xl border border-slate-800/80 my-4">
      <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center text-slate-400 mb-4">
        <Inbox className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-slate-200 mb-1">{title}</h3>
      <p className="text-sm text-slate-400 max-w-sm mb-6">{description}</p>
      {actionButton}
    </div>
  );
}
