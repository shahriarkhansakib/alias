import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  FileText, 
  CheckCircle, 
  BarChart2, 
  Eye, 
  Users, 
  PenSquare, 
  ArrowRight,
  TrendingUp,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { apiService } from '../services/api';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import CampaignTrackingSection from '../components/CampaignTrackingSection';
import ConnectWebsiteSection from '../components/ConnectWebsiteSection';
import { formatDate } from '../utils/formatters';

export default function DashboardPage() {
  const [overview, setOverview] = useState(null);
  const [posts, setPosts] = useState([]);
  const [connectedWebsites, setConnectedWebsites] = useState([]);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const loadDashboardData = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [overviewRes, postsRes, websitesRes] = await Promise.allSettled([
        forceRefresh ? apiService.getOverview({ refresh: 'true' }) : apiService.getOverview(),
        apiService.getPosts(),
        apiService.getTrackingWebsites(),
      ]);

      if (overviewRes.status === 'fulfilled' && overviewRes.value?.overview) {
        setOverview(overviewRes.value.overview);
      }

      if (postsRes.status === 'fulfilled' && postsRes.value?.posts) {
        setPosts(postsRes.value.posts);
      }

      if (websitesRes.status === 'fulfilled' && websitesRes.value?.websites) {
        const sites = websitesRes.value.websites || [];
        setConnectedWebsites(sites);
        if (sites.length > 0 && !selectedWebsiteId) {
          setSelectedWebsiteId(sites[0].id);
        }
      }
    } catch (err) {
      setError('Failed to fetch dashboard metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboardData(false);
  }, []);

  if (loading) {
    return <LoadingSpinner text="Fetching real-time marketing metrics..." />;
  }

  const publishedCount = posts.filter(p => p.status === 'published').length;
  const recentPosts = posts.slice(0, 5);
  const activeWebsite = connectedWebsites.find((w) => w.id === selectedWebsiteId) || connectedWebsites[0] || null;

  const hasAnalyticsData = overview && (overview.impressions > 0 || overview.reach > 0 || overview.totalPosts > 0 || posts.length > 0);

  // Mock chart data derived from real overview metric aggregates
  const chartData = overview ? [
    { name: 'Summed Reach', value: overview.reach || 0 },
    { name: 'Impressions', value: overview.impressions || 0 },
    { name: 'Reactions / Likes', value: overview.likes || 0 },
    { name: 'Comments', value: overview.comments || 0 },
    { name: 'Clicks', value: overview.clicks || 0 },
  ] : [];

  return (
    <div className="space-y-6">
      {/* Header & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass-panel p-6 rounded-2xl border border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">Social Publishing Control Center</h1>
          <p className="text-sm text-slate-400 mt-1">Real-time performance analytics & multi-platform publishing agent.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Connected Website Link & Selector */}
          {connectedWebsites.length === 1 && activeWebsite && (
            <a
              href={activeWebsite.origin}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold border border-slate-700/80 transition-colors shadow-sm"
              title={`Open ${activeWebsite.name} (${activeWebsite.origin}) in a new tab`}
            >
              <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
              <span>Open Connected Website</span>
            </a>
          )}

          {connectedWebsites.length > 1 && activeWebsite && (
            <div className="flex items-center gap-2 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
              <select
                value={selectedWebsiteId || activeWebsite.id}
                onChange={(e) => setSelectedWebsiteId(e.target.value)}
                className="bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500 max-w-[170px] truncate"
                aria-label="Select connected website to open"
              >
                {connectedWebsites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.origin})
                  </option>
                ))}
              </select>
              <a
                href={activeWebsite.origin}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold border border-slate-700 transition-colors"
                title={`Open ${activeWebsite.name} (${activeWebsite.origin}) in a new tab`}
              >
                <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
                <span>Open Connected Website</span>
              </a>
            </div>
          )}

          <button
            onClick={() => loadDashboardData(true)}
            disabled={refreshing || loading}
            aria-label="Refresh Data"
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Data</span>
          </button>
          <Link
            to="/create"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-all shadow-lg shadow-blue-500/20"
          >
            <PenSquare className="w-4 h-4" />
            <span>Create New Post</span>
          </Link>
        </div>
      </div>

      {/* Primary KPI Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Content Created"
          value={posts.length}
          icon={FileText}
          color="blue"
          subtitle="Internal post repository"
        />
        <StatCard
          title="Published Posts"
          value={publishedCount}
          icon={CheckCircle}
          color="emerald"
          subtitle={
            overview?.totalPosts && overview.totalPosts !== publishedCount
              ? `${publishedCount} local · ${overview.totalPosts} tracked in analytics`
              : "Live across target platforms"
          }
        />
        <StatCard
          title="Summed Reach"
          value={overview?.reach || 0}
          icon={Users}
          color="purple"
          subtitle="Sum of provider-returned reach values; not a deduplicated count of unique people."
        />
        <StatCard
          title="Aggregate Interaction Rate"
          value={`${overview?.engagementRate || 0}%`}
          icon={BarChart2}
          color="amber"
          subtitle="Pooled ratio: interactions (reactions/likes, comments, shares, clicks) divided by summed reach (or impressions if reach is zero); not an arithmetic average of post rates."
        />
      </div>

      {/* Charts & Analytics Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance Graph */}
        <div className="lg:col-span-2 glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-400" />
                Aggregated Reach & Impressions
              </h3>
              <p className="text-xs text-slate-400">Total metrics reported by backend analytics engine</p>
            </div>
            <Link to="/analytics" className="text-xs font-medium text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View Detailed <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {hasAnalyticsData ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '12px', color: '#f8fafc' }} 
                  />
                  <Area type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState
              title="No data available yet."
              description="Analytics metrics will populate automatically after your first social post is published."
            />
          )}
        </div>

        {/* Secondary Metrics Breakdown */}
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
          <h3 className="text-base font-semibold text-slate-100">Metric Breakdown</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                  <Eye className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Impressions</p>
                  <p className="text-sm font-bold text-slate-200">{overview?.impressions || 0}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <BarChart2 className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Reactions / Likes & Comments</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-sm font-bold text-slate-200">
                      {(overview?.likes || 0) + (overview?.comments || 0)}
                    </p>
                    <span className="text-[10px] text-slate-400">
                      ({overview?.likes || 0} reactions/likes · {overview?.comments || 0} comments)
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Facebook aggregate may include Love, Wow, and other reactions; subtype counts unavailable.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs text-slate-400">Total Shares & Clicks</p>
                  <p className="text-sm font-bold text-slate-200">{(overview?.shares || 0) + (overview?.clicks || 0)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Campaign Performance & Link Tracking */}
      <CampaignTrackingSection />

      {/* Phase 2: Connect Website & On-Site Activity Tracking */}
      <ConnectWebsiteSection />

      {/* Recent Posts Activity */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-slate-100">Recent Content Activity</h3>
          <Link to="/posts" className="text-xs font-medium text-blue-400 hover:text-blue-300 flex items-center gap-1">
            View All Posts <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {recentPosts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-900/80 text-xs uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Post ID</th>
                  <th className="py-3 px-4">Content Preview</th>
                  <th className="py-3 px-4">Platform</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {recentPosts.map((post) => (
                  <tr key={post.internalPostId} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-xs text-blue-400 font-medium">
                      {post.internalPostId.slice(0, 16)}...
                    </td>
                    <td className="py-3.5 px-4 max-w-xs truncate text-slate-200 font-medium">
                      {post.caption || '(No text caption)'}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="capitalize font-medium text-xs px-2 py-1 rounded bg-slate-800 text-slate-300">
                        {post.platforms?.[0]?.platform || 'facebook'}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={post.status} />
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-400">
                      {formatDate(post.createdAt)}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <Link
                        to={`/posts/${post.internalPostId}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-blue-400 hover:text-blue-300"
                      >
                        Analytics <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No data available yet."
            description="Create and publish your first social post to start tracking activity."
            actionButton={
              <Link
                to="/create"
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-all shadow-md"
              >
                Create First Post
              </Link>
            }
          />
        )}
      </div>
    </div>
  );
}
