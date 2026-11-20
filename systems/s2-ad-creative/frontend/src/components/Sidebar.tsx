'use client';

import React from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  Sparkles,
  FileText,
  Layers,
  ShieldCheck,
  FolderArchive,
  Settings,
  Terminal,
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', href: '/', icon: LayoutDashboard, badge: 'Live' },
    { id: 'briefs', label: 'Ad Briefs', href: '/dashboard/new', icon: FileText, badge: 'Live' },
    { id: 'jobs', label: 'Creative Jobs', href: '#', icon: Sparkles, badge: 'Phase 3' },
    { id: 'templates', label: 'Layout Engine', href: '#', icon: Layers, badge: 'Phase 4' },
    { id: 'qa', label: 'Automated QA', href: '#', icon: ShieldCheck, badge: 'Phase 6' },
    { id: 'assets', label: 'Storage & Assets', href: '#', icon: FolderArchive, badge: 'Phase 2' },
    { id: 'settings', label: 'Configuration', href: '#', icon: Settings, badge: null },
  ];

  return (
    <aside className="w-64 bg-slate-950 text-slate-300 border-r border-slate-800/80 flex flex-col shrink-0 min-h-screen">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
        <Link href="/" className="flex items-center space-x-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-white text-base tracking-tight block">Alias Img-Gen</span>
            <span className="text-xs text-slate-400 font-mono">v0.2.0 • Phase 2</span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-2 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
          Workspace
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const content = (
            <div
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <div className="flex items-center space-x-3">
                <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                    item.badge === 'Live'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </div>
          );

          if (item.href && item.href !== '#') {
            return (
              <Link key={item.id} href={item.href}>
                {content}
              </Link>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className="w-full text-left"
            >
              {content}
            </button>
          );
        })}
      </nav>

      {/* Bottom Architectural Callout */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/30">
        <div className="flex items-center space-x-2 text-xs text-slate-400 mb-1">
          <Terminal className="h-3.5 w-3.5 text-indigo-400" />
          <span className="font-semibold text-slate-300">Hard Validation Gate</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-400 font-sans">
          <strong className="text-emerald-300">Phase 2:</strong> Pydantic v2 Payload Gate + Image Alpha &amp; SSRF Asset Gate.
        </p>
      </div>
    </aside>
  );
};
