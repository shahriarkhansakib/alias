import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  ArrowLeft, 
  ExternalLink, 
  BarChart3, 
  Heart, 
  MessageSquare, 
  Share2, 
  Bookmark, 
  MousePointer, 
  Eye, 
  Users, 
  TrendingUp,
  Image as ImageIcon,
  RefreshCw,
  Award,
  Info,
  Smile,
  Globe,
  Layers,
  Filter,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { 
  AreaChart, Area, 
  BarChart, Bar, Cell, 
  LineChart, Line, Legend,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid 
} from 'recharts';
import { apiService } from '../services/api';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { formatDate } from '../utils/formatters';

function formatActivityTimestamp(timestamp) {
  if (!timestamp) return 'N/A';
  const str = String(timestamp).trim();
  // Date-only pattern e.g. "2026-11-17"
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  try {
    const date = new Date(str);
    if (isNaN(date.getTime())) return str;
    if (isDateOnly) {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
    }
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch (_e) {
    return str;
  }
}

function formatCommentTime(timestamp) {
  if (!timestamp) return 'সময় পাওয়া যায়নি';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return 'সময় পাওয়া যায়নি';
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch (_e) {
    return 'সময় পাওয়া যায়নি';
  }
}

export default function PostDetailsPage() {
  const { postId } = useParams();

  const [post, setPost] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState(null);
  const [commentsPagination, setCommentsPagination] = useState({ hasMore: false, nextCursor: null });
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);

  const [fbReactions, setFbReactions] = useState(null);
  const [fbReactionsLoading, setFbReactionsLoading] = useState(false);
  const [fbReactionsError, setFbReactionsError] = useState(null);

  const facebookReactionTypes = [
    { key: 'like', emoji: '👍', label: 'Like' },
    { key: 'love', emoji: '❤️', label: 'Love' },
    { key: 'haha', emoji: '😆', label: 'Haha' },
    { key: 'wow', emoji: '😮', label: 'Wow' },
    { key: 'sad', emoji: '😢', label: 'Sad' },
    { key: 'angry', emoji: '😡', label: 'Angry' },
    { key: 'care', emoji: '🥰', label: 'Care' },
  ];

  const fetchReactions = async () => {
    if (!postId) return;
    setFbReactionsLoading(true);
    setFbReactionsError(null);

    try {
      const res = await apiService.getPostReactions(postId);
      if (res && res.success) {
        setFbReactions(res);
      }
    } catch (err) {
      console.error('Failed to load reactions:', err);
      setFbReactionsError(
        err?.response?.data?.error || err.message || 'Failed to fetch Facebook reactions.'
      );
    } finally {
      setFbReactionsLoading(false);
    }
  };

  const fetchComments = async (cursor = null, isLoadMore = false) => {
    if (!postId) return;
    if (isLoadMore) {
      setLoadingMoreComments(true);
    } else {
      setCommentsLoading(true);
      setCommentsError(null);
    }

    try {
      const res = await apiService.getPostComments(postId, cursor);
      if (res && res.success) {
        if (isLoadMore) {
          setComments((prev) => [...prev, ...(res.comments || [])]);
        } else {
          setComments(res.comments || []);
        }
        setCommentsPagination(res.pagination || { hasMore: false, nextCursor: null });
      }
    } catch (err) {
      console.error('Failed to load comments:', err);
      setCommentsError(
        err?.response?.data?.error || err.message || 'Failed to fetch Facebook comments.'
      );
    } finally {
      setCommentsLoading(false);
      setLoadingMoreComments(false);
    }
  };

  const [comparisonMetric, setComparisonMetric] = useState('reach');
  const [showAllPlatforms, setShowAllPlatforms] = useState(true);
  const [activityFilter, setActivityFilter] = useState('all');
  const [visibleTimelineMetrics, setVisibleTimelineMetrics] = useState({
    impressions: true,
    reach: true,
    likes: true,
    comments: true,
    shares: true,
    clicks: true,
    saves: true,
    views: true,
    engagementRate: true,
  });

  const loadPostData = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [postRes, analyticsRes, timelineRes] = await Promise.allSettled([
        apiService.getPostById(postId),
        apiService.getPostAnalytics(postId, forceRefresh),
        apiService.getPostTimeline(postId, forceRefresh),
      ]);

      if (postRes.status === 'fulfilled' && postRes.value?.post) {
        const loadedPost = postRes.value.post;
        setPost(loadedPost);
        const fbTargeted = loadedPost.platforms?.some(
          (p) => (p.platform || '').toLowerCase() === 'facebook'
        );
        if (fbTargeted) {
          fetchComments();
          fetchReactions();
        }
      }

      if (analyticsRes.status === 'fulfilled' && analyticsRes.value) {
        setAnalytics(analyticsRes.value);
      }

      if (timelineRes.status === 'fulfilled' && timelineRes.value?.timeline) {
        setTimeline(timelineRes.value.timeline);
      }
    } catch (err) {
      setError('Failed to load post analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (postId) {
      loadPostData(false);
    }
  }, [postId]);

  const metrics = analytics?.metrics || {
    impressions: 0,
    reach: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    clicks: 0,
    views: 0,
    engagementRate: 0,
  };

  const isNoData = analytics?.status === 'no_data_yet';

  const targetedPublishedPlatforms = useMemo(() => {
    const list = [];
    const seen = new Set();

    if (Array.isArray(post?.platforms)) {
      for (const p of post.platforms) {
        const id = (p.platform || '').toLowerCase().trim();
        if (id && p.status !== 'not_targeted' && p.status !== 'failed' && !seen.has(id)) {
          seen.add(id);
          list.push({
            id,
            label: id.charAt(0).toUpperCase() + id.slice(1),
            status: p.status || 'published',
          });
        }
      }
    }

    if (Array.isArray(analytics?.platformBreakdown)) {
      for (const b of analytics.platformBreakdown) {
        const id = (b.platform || '').toLowerCase().trim();
        if (id && b.status !== 'not_targeted' && b.status !== 'failed' && !seen.has(id)) {
          seen.add(id);
          list.push({
            id,
            label: id.charAt(0).toUpperCase() + id.slice(1),
            status: b.status || 'published',
          });
        }
      }
    }

    if (list.length === 0) {
      const fallback = post?.platforms?.[0]?.platform || analytics?.platform;
      if (fallback) {
        const id = fallback.toLowerCase().trim();
        if (id && !seen.has(id)) {
          seen.add(id);
          list.push({
            id,
            label: id.charAt(0).toUpperCase() + id.slice(1),
            status: 'published',
          });
        }
      }
    }

    return list;
  }, [post, analytics]);

  const isSinglePlatform = targetedPublishedPlatforms.length === 1;
  const singlePlatform = isSinglePlatform ? targetedPublishedPlatforms[0] : null;
  const isFacebookTimeline = singlePlatform?.id === 'facebook';

  const hasFacebook = useMemo(() => {
    if (!post) return false;
    return (
      (Array.isArray(post.platforms) &&
        post.platforms.some((p) => (p.platform || '').toLowerCase() === 'facebook')) ||
      targetedPublishedPlatforms.some((p) => p.id === 'facebook')
    );
  }, [post, targetedPublishedPlatforms]);

  const toggleTimelineMetric = (key) => {
    setVisibleTimelineMetrics((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const timelineChartData = useMemo(() => {
    if (!Array.isArray(timeline) || timeline.length === 0) return [];
    return timeline.map((pt) => {
      const rawDate = pt.date ? String(pt.date).trim() : '';
      const dateOnly = rawDate ? rawDate.split('T')[0] : '';
      let displayDate = dateOnly;
      if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
        const [y, m, d] = dateOnly.split('-');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const mon = months[parseInt(m, 10) - 1] || m;
        displayDate = `${mon} ${parseInt(d, 10)}, ${y}`;
      }
      return {
        date: dateOnly,
        displayDate,
        impressions: pt.impressions !== undefined && pt.impressions !== null ? Number(pt.impressions) : null,
        reach: pt.reach !== undefined && pt.reach !== null ? Number(pt.reach) : null,
        likes: pt.likes !== undefined && pt.likes !== null ? Number(pt.likes) : null,
        comments: pt.comments !== undefined && pt.comments !== null ? Number(pt.comments) : null,
        shares: pt.shares !== undefined && pt.shares !== null ? Number(pt.shares) : null,
        clicks: pt.clicks !== undefined && pt.clicks !== null ? Number(pt.clicks) : null,
        saves: pt.saves !== undefined && pt.saves !== null ? Number(pt.saves) : null,
        views: pt.views !== undefined && pt.views !== null ? Number(pt.views) : null,
        engagementRate: pt.engagementRate !== undefined && pt.engagementRate !== null ? Number(pt.engagementRate) : null,
      };
    });
  }, [timeline]);

  const timelineMetricConfigs = [
    {
      key: 'impressions',
      label: 'Impressions',
      color: '#3b82f6',
      yAxisId: 'left',
    },
    {
      key: 'reach',
      label: 'Unique Reach',
      color: '#8b5cf6',
      yAxisId: 'left',
    },
    {
      key: 'likes',
      label: isFacebookTimeline ? 'Reactions (aggregate)' : 'Likes',
      color: '#10b981',
      yAxisId: 'left',
    },
    {
      key: 'comments',
      label: 'Comments',
      color: '#6366f1',
      yAxisId: 'left',
    },
    {
      key: 'shares',
      label: 'Shares',
      color: '#06b6d4',
      yAxisId: 'left',
    },
    {
      key: 'clicks',
      label: 'Link Clicks',
      color: '#f59e0b',
      yAxisId: 'left',
    },
    {
      key: 'saves',
      label: 'Saves',
      color: '#14b8a6',
      yAxisId: 'left',
    },
    {
      key: 'views',
      label: 'Views',
      color: '#ec4899',
      yAxisId: 'left',
    },
    {
      key: 'engagementRate',
      label: 'Engagement Rate (%)',
      color: '#f97316',
      yAxisId: 'right',
      strokeDasharray: '4 4',
    },
  ];

  if (loading) {
    return <LoadingSpinner text="Retrieving post identity mapping & analytics snapshot..." />;
  }

  if (!post && (!analytics || analytics.error || analytics.status === 404)) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            to="/posts"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Content Repository
          </Link>
        </div>
        <EmptyState
          title="Post Not Found"
          description={`No social post or analytics mapping found for ID: ${postId}`}
          actionButton={
            <Link
              to="/posts"
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-all shadow-md"
            >
              Return to Posts
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back Button & Navigation */}
      <div>
        <Link
          to="/posts"
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Content Repository
        </Link>
      </div>

      {/* Header Banner */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-100 font-mono">
              {post?.internalPostId || postId}
            </h1>
            <StatusBadge status={post?.status || analytics?.status} />
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Created on {formatDate(post?.createdAt || analytics?.fetchedAt)}
          </p>
        </div>

        {/* Upstream Links & Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => loadPostData(true)}
            disabled={refreshing || loading}
            aria-label="Refresh Data"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh Data'}
          </button>
          {post?.platforms?.[0]?.platformPostUrl && (
            <a
              href={post.platforms[0].platformPostUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-xs font-semibold border border-blue-500/20 transition-all"
            >
              Open Live Social Post <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Post Metadata Card */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Post Caption / Body</h3>
          <p className="text-sm text-slate-200 bg-slate-900/60 p-4 rounded-xl border border-slate-800 leading-relaxed">
            {post?.caption || '(No caption text provided for this post)'}
          </p>

          {/* Identity Mappings Display */}
          <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800">
              <span className="text-slate-400 block">Zernio Provider Post ID</span>
              <code className="text-blue-400 font-mono font-medium">{post?.providerPostId || 'Mapped in Database'}</code>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800">
              <span className="text-slate-400 block">Platform Post ID</span>
              <code className="text-emerald-400 font-mono font-medium">{post?.platforms?.[0]?.platformPostId || 'Resolved'}</code>
            </div>
          </div>
        </div>

        {/* Media Preview if URL exists */}
        {post?.imageUrl ? (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-blue-400" /> Media Attachment
            </h3>
            <div className="rounded-xl overflow-hidden border border-slate-800 bg-slate-900">
              <img src={post.imageUrl} alt="Post Attachment" className="w-full h-48 object-cover" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 rounded-xl bg-slate-900/40 border border-slate-800 text-center text-slate-500 text-xs">
            <ImageIcon className="w-8 h-8 mb-2 opacity-50" />
            <span>Text-only Social Post</span>
          </div>
        )}
      </div>

      {/* No Data Yet Banner */}
      {isNoData && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs space-y-1">
          <p className="font-semibold text-amber-200">Analytics Data Being Processed</p>
          <p className="text-amber-300/80">
            This post was published recently. Upstream metric snapshots are being aggregated by Zernio.
          </p>
        </div>
      )}

      {/* Key Analytics KPI Metrics Grid */}
      <div>
        <h2 className="text-base font-semibold text-slate-100 mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-400" /> Performance Metrics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard title="Impressions" value={metrics.impressions} icon={Eye} color="blue" />
          <StatCard title="Unique Reach" value={metrics.reach} icon={Users} color="purple" />
          <StatCard
            title={(post?.platforms?.[0]?.platform || analytics?.platform || '').toLowerCase() === 'facebook' ? 'Total Reactions' : 'Reactions'}
            value={metrics.likes}
            icon={Heart}
            color="emerald"
          />
          <StatCard title="Engagement Rate" value={`${metrics.engagementRate}%`} icon={TrendingUp} color="amber" />
          <StatCard title="Comments" value={metrics.comments} icon={MessageSquare} color="indigo" />
          <StatCard title="Shares" value={metrics.shares} icon={Share2} color="blue" />
          <StatCard title="Saves" value={metrics.saves} icon={Bookmark} color="emerald" />
          <StatCard title="Link Clicks" value={metrics.clicks} icon={MousePointer} color="purple" />
        </div>
      </div>

      {/* Historical Engagement Timeline Graph */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" /> Historical Engagement Timeline
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {isSinglePlatform
                ? `Historical trend for ${singlePlatform.label}`
                : targetedPublishedPlatforms.length > 1
                ? 'Multi-platform post'
                : 'Performance progression over time'}
            </p>
          </div>

          {/* Platform Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Platform:</span>
            {isSinglePlatform ? (
              <button
                type="button"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30 cursor-default"
                title={`${singlePlatform.label} (Timeline reliably associated)`}
              >
                <Globe className="w-3.5 h-3.5" />
                {singlePlatform.label}
              </button>
            ) : targetedPublishedPlatforms.length > 1 ? (
              <span className="text-xs text-amber-400/90 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                Unavailable (Multi-platform)
              </span>
            ) : (
              <span className="text-xs text-slate-500">None</span>
            )}
          </div>
        </div>

        {targetedPublishedPlatforms.length > 1 ? (
          <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <Info className="w-4 h-4 text-amber-400 shrink-0" />
              Per-Platform Historical Timeline Unavailable
            </div>
            <p className="text-slate-300 leading-relaxed">
              This post targets multiple published platforms ({targetedPublishedPlatforms.map((p) => p.label).join(', ')}).
              The current analytics provider supplies a combined post-level timeline without per-platform attribution.
              Per data integrity rules, combined aggregate timeline data is not duplicated or assigned across individual platforms.
            </p>
          </div>
        ) : timelineChartData.length > 0 ? (
          <div>
            {/* Metric Filter Toggles */}
            <div className="flex flex-wrap items-center gap-1.5 mb-5 pb-3 border-b border-slate-800/80">
              <span className="text-xs text-slate-400 mr-1 flex items-center gap-1">
                <Filter className="w-3 h-3 text-slate-400" /> Metrics:
              </span>
              {timelineMetricConfigs.map((cfg) => {
                const isVisible = visibleTimelineMetrics[cfg.key];
                return (
                  <button
                    key={cfg.key}
                    type="button"
                    onClick={() => toggleTimelineMetric(cfg.key)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                      isVisible
                        ? 'bg-slate-800 text-slate-200 border border-slate-700 shadow-sm'
                        : 'bg-slate-900/40 text-slate-500 border border-slate-800/60 opacity-60 line-through'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: isVisible ? cfg.color : '#64748b' }}
                    />
                    {cfg.label}
                  </button>
                );
              })}
            </div>

            {/* Multi-Line Chart */}
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timelineChartData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} />
                  <XAxis
                    dataKey="displayDate"
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="left"
                    stroke="#94a3b8"
                    fontSize={11}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#f97316"
                    fontSize={11}
                    tickLine={false}
                    unit="%"
                    domain={[0, 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '12px',
                      fontSize: '12px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                    }}
                    labelFormatter={(label) => `Date: ${label}`}
                    formatter={(val, name) => {
                      if (val === null || val === undefined) return ['Unavailable', name];
                      if (name.includes('Rate') || name.includes('%')) return [`${val}%`, name];
                      return [Number(val).toLocaleString(), name];
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: '14px', fontSize: '11px' }}
                    formatter={(value) => <span className="text-slate-300 font-medium">{value}</span>}
                  />
                  {timelineMetricConfigs.map((cfg) => {
                    if (!visibleTimelineMetrics[cfg.key]) return null;
                    return (
                      <Line
                        key={cfg.key}
                        type="monotone"
                        dataKey={cfg.key}
                        name={cfg.label}
                        stroke={cfg.color}
                        strokeWidth={2}
                        strokeDasharray={cfg.strokeDasharray}
                        yAxisId={cfg.yAxisId}
                        dot={{ r: 3, fill: cfg.color }}
                        activeDot={{ r: 5 }}
                        connectNulls={false}
                      />
                    );
                  })}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No timeline series data available."
            description="Timeline points will appear as analytics snapshots are collected over time."
          />
        )}
      </div>

      {/* Feature 1: Cross-Platform Performance Comparison Dashboard & Graph */}
      {(() => {
        const ALL_CHANNELS = [
          { id: 'facebook', label: 'Facebook', color: '#1877F2', bg: 'bg-blue-600/10', border: 'border-blue-500/30', text: 'text-blue-400' },
          { id: 'instagram', label: 'Instagram', color: '#E4405F', bg: 'bg-pink-600/10', border: 'border-pink-500/30', text: 'text-pink-400' },
          { id: 'tiktok', label: 'TikTok', color: '#00F2FE', bg: 'bg-cyan-600/10', border: 'border-cyan-500/30', text: 'text-cyan-400' },
          { id: 'youtube', label: 'YouTube', color: '#FF0000', bg: 'bg-red-600/10', border: 'border-red-500/30', text: 'text-red-400' },
          { id: 'x', label: 'X (Twitter)', color: '#38bdf8', bg: 'bg-sky-600/10', border: 'border-sky-500/30', text: 'text-sky-400' },
          { id: 'linkedin', label: 'LinkedIn', color: '#0A66C2', bg: 'bg-indigo-600/10', border: 'border-indigo-500/30', text: 'text-indigo-400' },
        ];

        const platformComparisonData = ALL_CHANNELS.map((ch) => {
          const breakdown = analytics?.platformBreakdown?.find(
            (b) => b.platform.toLowerCase() === ch.id.toLowerCase()
          );
          const localPlatform = post?.platforms?.find(
            (p) => p.platform?.toLowerCase() === ch.id.toLowerCase()
          );
          const isTargeted = breakdown
            ? breakdown.status !== 'not_targeted'
            : Boolean(localPlatform);

          const plMetrics = breakdown?.metrics || (isTargeted ? metrics : {
            impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, engagementRate: 0,
          });

          return {
            id: ch.id,
            label: ch.label,
            color: ch.color,
            bg: ch.bg,
            border: ch.border,
            text: ch.text,
            status: isTargeted ? 'published' : 'not_targeted',
            platformPostId: breakdown?.platformPostId || localPlatform?.platformPostId,
            platformPostUrl: breakdown?.platformPostUrl || localPlatform?.platformPostUrl,
            reach: plMetrics.reach || 0,
            impressions: plMetrics.impressions || 0,
            likes: plMetrics.likes || 0,
            comments: plMetrics.comments || 0,
            shares: plMetrics.shares || 0,
            clicks: plMetrics.clicks || 0,
            engagementRate: plMetrics.engagementRate || 0,
          };
        });

        const displayedPlatforms = showAllPlatforms
          ? platformComparisonData
          : platformComparisonData.filter((p) => p.status === 'published');

        const publishedChannels = platformComparisonData.filter((p) => p.status === 'published');
        const topPerformer = publishedChannels.length > 0
          ? publishedChannels.reduce((max, cur) => cur[comparisonMetric] > max[comparisonMetric] ? cur : max, publishedChannels[0])
          : null;

        const metricTabs = [
          { id: 'reach', label: 'Reach' },
          { id: 'impressions', label: 'Impressions' },
          { id: 'likes', label: 'Reactions' },
          { id: 'engagementRate', label: 'Engagement Rate (%)' },
          { id: 'comments', label: 'Comments' },
          { id: 'shares', label: 'Shares' },
          { id: 'clicks', label: 'Clicks' },
        ];

        return (
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
            {/* Header + Badges + Toggle */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-blue-400" />
                  Cross-Platform Performance Comparison
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Side-by-side metric comparison across all major social media channels for this post
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Best Performing Platform Badge */}
                {topPerformer && topPerformer[comparisonMetric] > 0 && (
                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
                    <Award className="w-3.5 h-3.5 text-amber-400" />
                    <span>Top Performer: <strong className="text-amber-200">{topPerformer.label}</strong> ({topPerformer[comparisonMetric]}{comparisonMetric === 'engagementRate' ? '%' : ''})</span>
                  </div>
                )}

                {/* Toggle All vs Targeted */}
                <button
                  type="button"
                  onClick={() => setShowAllPlatforms(!showAllPlatforms)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  {showAllPlatforms ? 'Showing All 6 Channels' : 'Targeted Channels Only'}
                </button>
              </div>
            </div>

            {/* Metric Selector Tabs */}
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
              <span className="text-xs font-medium text-slate-400 mr-1">Compare by:</span>
              {metricTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setComparisonMetric(tab.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    comparisonMetric === tab.id
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Recharts Bar Chart */}
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displayedPlatforms} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} />
                  <YAxis stroke="#94a3b8" fontSize={12} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '12px' }}
                    formatter={(val, name, item) => [
                      `${val}${comparisonMetric === 'engagementRate' ? '%' : ''} (${item.payload.status === 'published' ? 'Live' : 'Not Targeted'})`,
                      metricTabs.find((m) => m.id === comparisonMetric)?.label || comparisonMetric
                    ]}
                  />
                  <Bar dataKey={comparisonMetric} radius={[8, 8, 0, 0]}>
                    {displayedPlatforms.map((entry) => (
                      <Cell
                        key={`cell-${entry.id}`}
                        fill={entry.status === 'published' ? entry.color : '#475569'}
                        opacity={entry.status === 'published' ? 0.9 : 0.3}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Platform Comparison Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
              {displayedPlatforms.map((pl) => (
                <div
                  key={pl.id}
                  className={`p-4 rounded-xl border transition-all ${
                    pl.status === 'published'
                      ? 'bg-slate-900/60 border-slate-700/80 shadow-sm'
                      : 'bg-slate-900/20 border-slate-800/60 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pl.color }} />
                      {pl.label}
                    </span>
                    <span
                      className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                        pl.status === 'published'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {pl.status === 'published' ? 'Active Target' : 'Not Targeted'}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="p-2 rounded-lg bg-slate-800/40 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">Reach</span>
                      <span className="font-semibold text-slate-200">{pl.reach}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-800/40 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">Reactions</span>
                      <span className="font-semibold text-emerald-400">{pl.likes}</span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-800/40 border border-slate-800">
                      <span className="text-slate-400 block text-[10px]">Eng. Rate</span>
                      <span className="font-semibold text-amber-400">{pl.engagementRate}%</span>
                    </div>
                  </div>

                  {pl.platformPostUrl && (
                    <div className="mt-3 pt-2 border-t border-slate-800 flex justify-end">
                      <a
                        href={pl.platformPostUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-400 hover:text-blue-300 transition-colors"
                      >
                        View Platform Post <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Feature 2: Reaction Breakdown & Engagement Activity Log */}
      {(() => {
        const hasReactionBreakdown = Boolean(
          analytics?.reactionBreakdown &&
          typeof analytics.reactionBreakdown === 'object' &&
          ['like', 'love', 'haha', 'wow', 'sad', 'angry'].some(
            (k) => typeof analytics.reactionBreakdown[k] === 'number'
          )
        );

        const reactions = hasReactionBreakdown
          ? [
              { key: 'like', emoji: '👍', label: 'Like', count: Number(analytics.reactionBreakdown.like || 0) },
              { key: 'love', emoji: '❤️', label: 'Love', count: Number(analytics.reactionBreakdown.love || 0) },
              { key: 'haha', emoji: '😆', label: 'Haha', count: Number(analytics.reactionBreakdown.haha || 0) },
              { key: 'wow', emoji: '😮', label: 'Wow', count: Number(analytics.reactionBreakdown.wow || 0) },
              { key: 'sad', emoji: '😢', label: 'Sad', count: Number(analytics.reactionBreakdown.sad || 0) },
              { key: 'angry', emoji: '😡', label: 'Angry', count: Number(analytics.reactionBreakdown.angry || 0) },
            ]
          : [];
        const totalBreakdownCount = reactions.reduce((sum, r) => sum + r.count, 0);

        const activities = Array.isArray(analytics?.engagementActivity) ? analytics.engagementActivity : [];
        const filteredActivities = activities.filter((item) => {
          if (activityFilter === 'reactions') return item.actionType !== 'comment';
          if (activityFilter === 'comments') return item.actionType === 'comment';
          return true;
        });

        return (
          <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
            {/* Section Header */}
            <div>
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <Heart className="w-4 h-4 text-rose-400" />
                Reactions & Audience Engagement Activity
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Audience reactions, interactions, and chronological activity feed for this post
              </p>
            </div>

            {/* Reaction Type Breakdown or Aggregate Notice */}
            {hasFacebook ? (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Facebook Reaction Counts by Type
                    </span>
                    {fbReactions && fbReactions.total !== null && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs font-semibold">
                        Total: {fbReactions.total}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchReactions()}
                    disabled={fbReactionsLoading}
                    className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5 self-start sm:self-auto"
                    title="Fetch latest reaction counts by type from Facebook"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${fbReactionsLoading ? 'animate-spin' : ''}`} />
                    <span>{fbReactionsLoading ? 'Refreshing...' : 'Refresh Reactions'}</span>
                  </button>
                </div>

                {fbReactionsLoading && !fbReactions ? (
                  <div className="py-6 flex flex-col items-center justify-center text-center">
                    <LoadingSpinner size="sm" />
                    <p className="text-xs text-slate-400 mt-2">Loading Facebook reaction counts...</p>
                  </div>
                ) : fbReactionsError && !fbReactions ? (
                  <div className="p-3.5 rounded-xl bg-red-950/20 border border-red-900/40 text-xs text-red-300 flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-red-200">Unable to load Facebook reactions</p>
                        <p className="text-red-400/90 mt-0.5">{fbReactionsError}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => fetchReactions()}
                      className="px-2.5 py-1 rounded bg-red-800/30 hover:bg-red-800/50 text-red-200 border border-red-700/50 text-xs font-medium shrink-0"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                      {facebookReactionTypes.map((r) => {
                        const count = fbReactions?.reactions?.[r.key];
                        return (
                          <div
                            key={r.key}
                            className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex flex-col items-center justify-center text-center gap-1"
                          >
                            <span className="text-xl">{r.emoji}</span>
                            <span className="text-[11px] font-medium text-slate-400">{r.label}</span>
                            <span className="text-xs font-bold text-slate-100 font-mono">
                              {count !== null && count !== undefined ? count : 'Unavailable'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1.5 italic">
                      <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      Individual Facebook reactor identities are not provided by Facebook. Aggregate reaction counts by type are shown above.
                    </p>
                  </div>
                )}
              </div>
            ) : hasReactionBreakdown ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-medium">Reaction Breakdown</span>
                  <span>Total Reactions: <strong className="text-slate-200">{totalBreakdownCount}</strong></span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                  {reactions.map((r) => (
                    <div
                      key={r.key}
                      className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between"
                    >
                      <span className="flex items-center gap-1.5 text-sm">
                        <span>{r.emoji}</span>
                        <span className="text-xs font-medium text-slate-300">{r.label}</span>
                      </span>
                      <span className="text-xs font-bold text-slate-100 font-mono">
                        {r.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-300">Total Reactions (Aggregate)</span>
                  <span className="text-base font-bold text-emerald-400 font-mono">{metrics.likes}</span>
                </div>
                <p className="text-xs text-slate-400 flex items-start gap-1.5 leading-relaxed">
                  <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>Reaction-type breakdown (Like, Love, Haha, Wow, Sad, Angry) is not provided by the upstream analytics provider for this post. Total aggregate reactions are tracked above.</span>
                </p>
              </div>
            )}

            {/* Chronological Engagement Activity Log */}
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <Filter className="w-3.5 h-3.5 text-blue-400" />
                  Activity Stream ({filteredActivities.length})
                </h4>

                {/* Filter Tabs */}
                {activities.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {[
                      { id: 'all', label: `All (${activities.length})` },
                      { id: 'reactions', label: `Reactions (${activities.filter((a) => a.actionType !== 'comment').length})` },
                      { id: 'comments', label: `Comments (${activities.filter((a) => a.actionType === 'comment').length})` },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setActivityFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                          activityFilter === f.id
                            ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30 font-semibold'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {activities.length > 0 ? (
                filteredActivities.length > 0 ? (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {filteredActivities.map((act) => (
                      <div
                        key={act.id}
                        className="p-3 rounded-xl bg-slate-900/40 border border-slate-800 flex items-start justify-between gap-3 hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          {/* Avatar */}
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {(act.actorName || 'User')
                              .split(' ')
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join('')
                              .toUpperCase()}
                          </div>

                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-slate-200">
                                {act.actorName}
                              </span>
                              {(act.isVerified || act.verified) && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                                  Verified
                                </span>
                              )}
                              <span className="text-[11px] font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                                {act.reactionLabel || act.actionType}
                              </span>
                            </div>

                            {act.commentText && (
                              <p className="text-xs text-slate-300 mt-1 italic bg-slate-950/40 p-2 rounded-lg border border-slate-800/80">
                                "{act.commentText}"
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">
                            {act.platform}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {formatActivityTimestamp(act.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 rounded-xl bg-slate-900/20 border border-slate-800 text-slate-500 text-xs">
                    No activity items found for the selected filter.
                  </div>
                )
              ) : (
                <div className="text-center py-8 rounded-xl bg-slate-900/30 border border-slate-800 text-slate-400 text-xs space-y-2 p-6">
                  <p className="font-semibold text-slate-200">Individual Activity Details Unavailable</p>
                  <p className="text-slate-400 max-w-md mx-auto leading-relaxed">
                    Individual interaction events (reactor identities, comment text, and exact timestamps) are not provided by the current analytics provider. Aggregate performance metrics and the daily timeline are displayed above.
                  </p>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Feature 3: Facebook Comments (On-Demand, Read-Only) */}
      {hasFacebook && (
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                Facebook Comments
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                On-demand, read-only comments from your connected Facebook Page
              </p>
            </div>

            <div className="flex items-center gap-2">
              {comments.length > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-semibold">
                  {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
                </span>
              )}
              <button
                type="button"
                onClick={() => fetchComments(null, false)}
                disabled={commentsLoading}
                className="btn-secondary text-xs flex items-center gap-1.5 px-3 py-1.5"
                title="Fetch latest comments from Facebook"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${commentsLoading ? 'animate-spin' : ''}`} />
                <span>{commentsLoading ? 'Refreshing...' : 'Refresh Comments'}</span>
              </button>
            </div>
          </div>

          {commentsLoading && comments.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center">
              <LoadingSpinner size="md" />
              <p className="text-xs text-slate-400 mt-3">Fetching comments from Facebook...</p>
            </div>
          ) : commentsError && comments.length === 0 ? (
            <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/40 text-xs text-red-300 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-200">Unable to load Facebook comments</p>
                  <p className="text-red-400/90 mt-0.5">{commentsError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => fetchComments(null, false)}
                className="px-3 py-1 rounded-lg bg-red-800/30 hover:bg-red-800/50 text-red-200 border border-red-700/50 text-xs font-medium shrink-0 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : comments.length === 0 ? (
            <div className="text-center py-8 rounded-xl bg-slate-900/30 border border-slate-800 text-slate-400 text-xs space-y-2 p-6">
              <MessageSquare className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="font-semibold text-slate-200">No Facebook Comments Found</p>
              <p className="text-slate-400 max-w-md mx-auto leading-relaxed">
                There are currently no comments recorded on this post, or none returned by Facebook.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800/80 hover:border-slate-700 transition-colors flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(comment.authorName || 'U')
                            .split(' ')
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join('')
                            .toUpperCase()}
                        </div>
                        <span className="text-xs font-semibold text-slate-200">
                          {comment.authorName || 'Anonymous'}
                        </span>
                        <span className="text-[10px] uppercase font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded border border-blue-500/20">
                          Facebook
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {formatCommentTime(comment.createdAt)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 pl-9 whitespace-pre-wrap leading-relaxed">
                      {comment.text}
                    </p>
                  </div>
                ))}
              </div>

              {commentsPagination.hasMore && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    onClick={() => fetchComments(commentsPagination.nextCursor, true)}
                    disabled={loadingMoreComments}
                    className="btn-secondary text-xs px-4 py-2 inline-flex items-center gap-2"
                  >
                    {loadingMoreComments && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{loadingMoreComments ? 'Loading more comments...' : 'Load More Comments'}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
