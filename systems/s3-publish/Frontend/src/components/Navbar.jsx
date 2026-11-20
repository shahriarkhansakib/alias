import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Bell, CheckCircle2, AlertCircle, Menu, LogOut, LogIn } from 'lucide-react';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function Navbar({ onToggleSidebar }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [healthStatus, setHealthStatus] = useState('checking');

  useEffect(() => {
    apiService
      .verifyAuth()
      .then(() => setHealthStatus('connected'))
      .catch(() => setHealthStatus('disconnected'));
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      navigate('/login');
    }
  };

  const getTitle = () => {
    switch (location.pathname) {
      case '/':
        return 'Executive Overview';
      case '/create':
        return 'Create & Publish Content';
      case '/posts':
        return 'Content Repository';
      case '/analytics':
        return 'Social Performance Analytics';
      case '/accounts':
        return 'Connected Social Channels';
      default:
        if (location.pathname.startsWith('/posts/')) return 'Post Analytics Details';
        return 'Dashboard';
    }
  };

  const userInitials = user?.email
    ? user.email.substring(0, 2).toUpperCase()
    : 'AI';

  return (
    <header className="h-16 bg-slate-900/80 backdrop-blur-md border-b border-slate-800/80 px-4 md:px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3">
        {/* Mobile menu trigger */}
        <button
          onClick={onToggleSidebar}
          className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 md:hidden"
          aria-label="Open Navigation Menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h2 className="text-base md:text-lg font-semibold text-slate-100 truncate">{getTitle()}</h2>
      </div>

      <div className="flex items-center gap-3 md:gap-4">
        {/* System Health Indicator */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/50 text-xs">
          {healthStatus === 'connected' ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-slate-300 font-medium">Zernio Engine Ready</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-300 font-medium">API Connecting...</span>
            </>
          )}
        </div>

        {/* Notifications Icon */}
        <button className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors relative">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500"></span>
        </button>

        {/* User / Auth Section */}
        {user ? (
          <div className="flex items-center gap-3 pl-2 border-l border-slate-800">
            <div className="w-8 h-8 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm shrink-0">
              {userInitials}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-medium text-slate-200 max-w-[120px] truncate">{user.email}</p>
              <p className="text-[10px] text-slate-400 capitalize">{user.role}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="pl-2 border-l border-slate-800">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
