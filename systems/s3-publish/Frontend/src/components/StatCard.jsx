import React from 'react';
import { formatNumber } from '../utils/formatters';

export default function StatCard({ title, value, icon: Icon, color = 'blue', subtitle }) {
  const colorStyles = {
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  };

  const badgeStyle = colorStyles[color] || colorStyles.blue;

  return (
    <div className="glass-panel p-5 rounded-2xl border border-slate-800/80 shadow-lg relative overflow-hidden group hover:border-slate-700/80 transition-all duration-300">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">{title}</p>
          <h3 className="text-2xl font-bold text-slate-100 tracking-tight">
            {typeof value === 'number' ? formatNumber(value) : value}
          </h3>
          {subtitle && (
            <p className="text-xs text-slate-400 mt-1 font-medium">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className={`p-3 rounded-xl border ${badgeStyle} transition-transform duration-300 group-hover:scale-110`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  );
}
