import React, { useEffect, useState } from 'react';
import { 
  BarChart3, 
  Filter, 
  Calendar, 
  Users, 
  Eye, 
  Heart, 
  MessageSquare, 
  Share2, 
  MousePointer, 
  TrendingUp,
  RefreshCw
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { apiService } from '../services/api';
import StatCard from '../components/StatCard';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';

export default function AnalyticsPage() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [platform, setPlatform] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const fetchAnalytics = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const filter = {
        platform: platform || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      };
      const res = await apiService.getOverview(filter, forceRefresh);
      setOverview(res.overview || null);
    } catch (err) {
      setError('Failed to fetch social analytics overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics(false);
  }, [platform]);

  const handleApplyFilter = (e) => {
    e.preventDefault();
    fetchAnalytics(false);
  };

  const isDataAvailable = overview && (overview.totalPosts > 0 || overview.impressions > 0 || overview.reach > 0);

  // Chart dataset based on overview metric values
  const breakdownData = overview ? [
    { name: 'Impressions', count: overview.impressions || 0 },
    { name: 'Summed Reach', count: overview.reach || 0 },
    { name: 'Reactions / Likes', count: overview.likes || 0 },
    { name: 'Comments', count: overview.comments || 0 },
    { name: 'Shares', count: overview.shares || 0 },
    { name: 'Link Clicks', count: overview.clicks || 0 },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-400" />
            Social Analytics Overview
          </h1>
          <p className="text-xs text-slate-400 mt-1">Aggregated engagement & reach metrics across active social target channels.</p>
        </div>
        <button
          onClick={() => fetchAnalytics(true)}
          disabled={loading}
          aria-label="Refresh Data"
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh Data
        </button>
      </div>

      {/* Filter Controls Bar */}
      <form onSubmit={handleApplyFilter} className="glass-panel p-4 rounded-2xl border border-slate-800 flex flex-wrap items-center gap-4 justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {/* Platform Dropdown */}
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-2 rounded-xl border border-slate-800 text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <label htmlFor="analyticsPlatformSelect" className="text-slate-400">Platform:</label>
            <select
              id="analyticsPlatformSelect"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="" className="bg-slate-900">All Platforms</option>
              <option value="facebook" className="bg-slate-900">Facebook</option>
              <option value="linkedin" className="bg-slate-900">LinkedIn</option>
              <option value="instagram" className="bg-slate-900">Instagram</option>
              <option value="twitter" className="bg-slate-900">X / Twitter</option>
            </select>
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <label htmlFor="fromDateInput" className="text-slate-400">From:</label>
            <input
              id="fromDateInput"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
            <label htmlFor="toDateInput" className="text-slate-400">To:</label>
            <input
              id="toDateInput"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all focus:ring-2 focus:ring-blue-400"
        >
          Apply Filters
        </button>
      </form>

      {/* Analytics KPI Cards */}
      {loading ? (
        <LoadingSpinner text="Computing analytics overview metrics..." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total Posts Analyzed" value={overview?.totalPosts || 0} icon={BarChart3} color="blue" />
            <StatCard
              title="Summed Reach"
              value={overview?.reach || 0}
              icon={Users}
              color="purple"
              subtitle="Sum of provider-returned reach values; not a deduplicated count of unique people."
            />
            <StatCard title="Total Impressions" value={overview?.impressions || 0} icon={Eye} color="blue" />
            <StatCard
              title="Aggregate Interaction Rate"
              value={`${overview?.engagementRate || 0}%`}
              icon={TrendingUp}
              color="amber"
              subtitle="Pooled ratio: interactions (reactions/likes, comments, shares, clicks) divided by summed reach (or impressions if reach is zero); not an arithmetic average of post rates."
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              title="Reactions / Likes"
              value={overview?.likes || 0}
              icon={Heart}
              color="emerald"
              subtitle="Facebook aggregate may include Love, Wow, and other reactions; subtype counts unavailable."
            />
            <StatCard title="Comments" value={overview?.comments || 0} icon={MessageSquare} color="indigo" />
            <StatCard title="Shares" value={overview?.shares || 0} icon={Share2} color="blue" />
            <StatCard title="Link Clicks" value={overview?.clicks || 0} icon={MousePointer} color="purple" />
          </div>

          {/* Metrics Distribution Bar Chart */}
          <div className="glass-panel p-6 rounded-2xl border border-slate-800">
            <h3 className="text-base font-semibold text-slate-100 mb-4">Cross-Platform Metric Distribution</h3>
            {isDataAvailable ? (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={breakdownData} margin={{ top: 20, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc' }} />
                    <Legend />
                    <Bar dataKey="count" name="Metric Count" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                title="No analytics overview data available."
                description="Selected filter criteria or current repository has no active analytics history."
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
