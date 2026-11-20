import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Search, Filter, ArrowRight, PenSquare, RefreshCw } from 'lucide-react';
import { apiService } from '../services/api';
import StatusBadge from '../components/StatusBadge';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { formatDate } from '../utils/formatters';

export default function PostsPage() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchPosts = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getPosts();
      setPosts(data.posts || []);
    } catch (err) {
      setError('Failed to fetch content repository');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  // Filter logic
  const filteredPosts = posts.filter((post) => {
    const matchesSearch =
      !searchQuery ||
      (post.caption && post.caption.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (post.internalPostId && post.internalPostId.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesPlatform =
      platformFilter === 'all' ||
      post.platforms?.some((p) => p.platform.toLowerCase() === platformFilter.toLowerCase());

    const matchesStatus =
      statusFilter === 'all' || (post.status && post.status.toLowerCase() === statusFilter.toLowerCase());

    return matchesSearch && matchesPlatform && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-400" />
            Social Content Repository
          </h1>
          <p className="text-xs text-slate-400 mt-1">Manage and inspect all social posts stored in PostgreSQL persistence.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchPosts}
            aria-label="Refresh Posts"
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors focus:ring-2 focus:ring-blue-500"
            title="Refresh Posts"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <Link
            to="/create"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 focus:ring-2 focus:ring-blue-400"
          >
            <PenSquare className="w-4 h-4" />
            New Post
          </Link>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="glass-panel p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row gap-4 justify-between">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            aria-label="Search posts by caption or ID"
            placeholder="Search by caption or post ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Platform & Status Dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <label htmlFor="platformSelect" className="text-slate-400">Platform:</label>
            <select
              id="platformSelect"
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900">All Platforms</option>
              <option value="facebook" className="bg-slate-900">Facebook</option>
              <option value="linkedin" className="bg-slate-900">LinkedIn</option>
              <option value="instagram" className="bg-slate-900">Instagram</option>
              <option value="twitter" className="bg-slate-900">X / Twitter</option>
            </select>
          </div>

          <div className="flex items-center gap-2 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
            <label htmlFor="statusSelect" className="text-slate-400">Status:</label>
            <select
              id="statusSelect"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="all" className="bg-slate-900">All Statuses</option>
              <option value="published" className="bg-slate-900">Published</option>
              <option value="scheduled" className="bg-slate-900">Scheduled</option>
              <option value="partial" className="bg-slate-900">Partial</option>
              <option value="failed" className="bg-slate-900">Failed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Posts Table / Loading / Empty State */}
      {loading ? (
        <LoadingSpinner text="Loading post repository..." />
      ) : filteredPosts.length > 0 ? (
        <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-300">
              <thead className="bg-slate-900/80 text-xs uppercase text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3.5 px-4">Post ID</th>
                  <th className="py-3.5 px-4">Content Preview</th>
                  <th className="py-3.5 px-4">Target Platform</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Created Date</th>
                  <th className="py-3.5 px-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredPosts.map((post) => (
                  <tr key={post.internalPostId} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-4 px-4 font-mono text-xs text-blue-400 font-medium">
                      {post.internalPostId}
                    </td>
                    <td className="py-4 px-4 max-w-xs sm:max-w-sm truncate text-slate-200 font-medium">
                      {post.caption || '(Media-only post)'}
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-wrap gap-1">
                        {post.platforms?.map((pl, i) => (
                          <span key={i} className="capitalize text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {pl.platform}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <StatusBadge status={post.status} />
                    </td>
                    <td className="py-4 px-4 text-xs text-slate-400 whitespace-nowrap">
                      {formatDate(post.createdAt)}
                    </td>
                    <td className="py-4 px-4 text-right whitespace-nowrap">
                      <Link
                        to={`/posts/${post.internalPostId}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 text-xs font-semibold transition-all border border-blue-500/20 focus:ring-2 focus:ring-blue-400"
                      >
                        Inspect <ArrowRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          title="No posts found."
          description={
            searchQuery || platformFilter !== 'all' || statusFilter !== 'all'
              ? 'No content matches your current filter criteria. Try resetting filters.'
              : 'Your social repository is currently empty.'
          }
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
  );
}
