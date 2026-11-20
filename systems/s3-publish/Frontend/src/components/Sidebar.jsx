import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
  PenSquare, 
  FileText, 
  BarChart3, 
  Share2, 
  Sparkles,
  X,
  Lock
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Sidebar({ isOpen, onClose }) {
  const { hasSelectedAccount } = useAuth();

  const navItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'Create Post', path: '/create', icon: PenSquare },
    { label: 'All Posts', path: '/posts', icon: FileText },
    { label: 'Analytics', path: '/analytics', icon: BarChart3 },
    { label: 'Social Accounts', path: '/accounts', icon: Share2 },
  ];

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`w-64 bg-slate-900 border-r border-slate-800 min-h-screen flex flex-col justify-between p-4 fixed left-0 top-0 bottom-0 z-50 transition-transform duration-300 ease-in-out md:translate-x-0 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div>
          {/* Brand Header */}
          <div className="flex items-center justify-between px-3 py-4 mb-6 border-b border-slate-800/80">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-bold text-lg text-slate-100 leading-tight">M.I.R.A</h1>
                <p className="text-xs text-blue-400 font-medium">AI Marketing Suite</p>
              </div>
            </div>

            {/* Close button for mobile */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 md:hidden"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Onboarding Notice when account selection is pending */}
          {!hasSelectedAccount && (
            <div className="mb-3 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span>Select an account to unlock navigation</span>
            </div>
          )}

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isAccountsPage = item.path === '/accounts' || item.path === '/social-accounts';
              const isDisabled = !hasSelectedAccount && !isAccountsPage;

              if (isDisabled) {
                return (
                  <button
                    key={item.path}
                    type="button"
                    disabled
                    aria-disabled="true"
                    data-disabled="true"
                    className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-sm text-slate-500 bg-slate-900/30 border border-slate-800/40 cursor-not-allowed opacity-40 select-none text-left"
                    title="Complete social account selection on Social Accounts to unlock"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-slate-500" />
                      <span>{item.label}</span>
                    </div>
                    <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  </button>
                );
              }

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-200 ${
                      isActive
                        ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30 shadow-sm'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                    }`
                  }
                >
                  <Icon className="w-4 h-4" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Footer Info Badge */}
        <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800/80 text-xs text-slate-400">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-semibold text-slate-300">Backend Connected</span>
          </div>
          <p className="text-slate-500 text-[11px]">API: http://localhost:3000</p>
        </div>
      </aside>
    </>
  );
}
