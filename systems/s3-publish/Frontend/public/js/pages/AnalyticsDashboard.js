import { analyticsApi } from '../services/analyticsApi.js';
import { renderMetricCard } from '../components/MetricCard.js';
import { renderAnalyticsFilters } from '../components/AnalyticsFilters.js';
import { renderPerformanceChart } from '../components/PerformanceChart.js';
import { renderPostPerformanceTable } from '../components/PostPerformanceTable.js';
import { renderPostDetailsModal } from '../components/PostDetailsModal.js';

export class AnalyticsDashboard {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.filters = { platform: 'all', fromDate: '', toDate: '' };
    this.overviewData = null;
    this.postsData = [];
    this.postAnalyticsMap = {};
    this.activeChartMetric = 'reach';
    this.selectedPost = null;
    this.selectedPostAnalytics = null;
    this.loading = false;
    this.error = null;
  }

  async init() {
    await this.loadData();
  }

  async loadData(forceRefresh = false) {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      // 1. Fetch Overview & Published Posts concurrently
      const [overviewRes, postsRes] = await Promise.all([
        analyticsApi.fetchOverview(this.filters, forceRefresh),
        analyticsApi.fetchPublishedPosts(),
      ]);

      this.overviewData = overviewRes.overview || {};
      this.postsData = postsRes.posts || [];

      // 2. Fetch individual analytics for posts safely
      const analyticsPromises = this.postsData.map(async (p) => {
        const postId = p.internalPostId || p.providerPostId || p.postId;
        if (!postId) return;
        try {
          const analytics = await analyticsApi.fetchPostAnalytics(postId, forceRefresh);
          this.postAnalyticsMap[postId] = analytics;
        } catch {
          // If no analytics data yet, populate fallback object
          this.postAnalyticsMap[postId] = {
            postId,
            metrics: { reach: 0, impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0, views: 0, engagementRate: 0 },
            reactionBreakdown: null,
            timeline: [],
          };
        }
      });

      await Promise.allSettled(analyticsPromises);
    } catch (err) {
      console.error('Analytics load error:', err);
      this.error = err.message || 'Failed to load analytics dashboard data.';
    } finally {
      this.loading = false;
      this.render();
    }
  }

  renderLoadingSkeleton() {
    return `
      <div class="dashboard-header">
        <div class="skeleton" style="width: 240px; height: 32px;"></div>
        <div class="skeleton" style="width: 380px; height: 36px;"></div>
      </div>
      <div class="metrics-grid">
        ${Array(8)
          .fill(0)
          .map(
            () => `
          <div class="metric-card">
            <div class="skeleton" style="width: 80px; height: 16px; margin-bottom: 12px;"></div>
            <div class="skeleton" style="width: 120px; height: 32px;"></div>
          </div>
        `
          )
          .join('')}
      </div>
      <div class="chart-card">
        <div class="skeleton" style="width: 100%; height: 260px;"></div>
      </div>
    `;
  }

  renderErrorState() {
    return `
      <div class="error-state card">
        <div class="state-icon">⚠️</div>
        <h3>Analytics Dashboard Unavailable</h3>
        <p style="margin: 0.5rem 0 1.5rem; color: var(--text-muted);">${this.error}</p>
        <button id="btn-retry-analytics" class="btn" style="max-width: 200px; margin: 0 auto;">
          🔄 Retry Loading
        </button>
      </div>
    `;
  }

  render() {
    if (!this.container) return;

    if (this.loading) {
      this.container.innerHTML = this.renderLoadingSkeleton();
      return;
    }

    if (this.error) {
      this.container.innerHTML = this.renderErrorState();
      this.attachEvents();
      return;
    }

    const o = this.overviewData || {};
    const timelineData = (this.postsData.length > 0 && this.postAnalyticsMap[this.postsData[0]?.internalPostId]?.timeline) || [];

    this.container.innerHTML = `
      <div class="dashboard-header">
        <h2 class="dashboard-title">📊 Analytics Overview</h2>
        ${renderAnalyticsFilters(this.filters)}
      </div>

      <!-- 9 Overview Metric Cards -->
      <div class="metrics-grid">
        ${renderMetricCard({ label: 'Total Posts', value: o.totalPosts || 0, icon: '📝' })}
        ${renderMetricCard({ label: 'Reach', value: o.reach || 0, icon: '🎯' })}
        ${renderMetricCard({ label: 'Impressions', value: o.impressions || 0, icon: '👁️' })}
        ${renderMetricCard({ label: 'Likes', value: o.likes || 0, icon: '👍' })}
        ${renderMetricCard({ label: 'Comments', value: o.comments || 0, icon: '💬' })}
        ${renderMetricCard({ label: 'Shares', value: o.shares || 0, icon: '🔁' })}
        ${renderMetricCard({ label: 'Clicks', value: o.clicks || 0, icon: '🔗' })}
        ${renderMetricCard({ label: 'Views', value: o.views || 0, icon: '▶️' })}
        ${renderMetricCard({ label: 'Engagement Rate', value: o.engagementRate || 0, icon: '🔥', format: 'percentage' })}
      </div>

      <!-- Performance Time-Series Chart -->
      <div id="chart-container">
        ${renderPerformanceChart(timelineData, this.activeChartMetric)}
      </div>

      <!-- Recent Posts Performance Table -->
      <div id="posts-table-container">
        ${renderPostPerformanceTable(this.postsData, this.postAnalyticsMap)}
      </div>

      <!-- Modal Container -->
      <div id="modal-container">
        ${this.selectedPost ? renderPostDetailsModal(this.selectedPost, this.selectedPostAnalytics) : ''}
      </div>
    `;

    this.attachEvents();
  }

  attachEvents() {
    // Retry button
    const retryBtn = document.getElementById('btn-retry-analytics');
    if (retryBtn) {
      retryBtn.onclick = () => this.loadData();
    }

    // Refresh button
    const refreshBtn = document.getElementById('btn-refresh-dashboard');
    if (refreshBtn) {
      refreshBtn.onclick = () => this.loadData(true);
    }

    // Filter Apply & Reset
    const applyBtn = document.getElementById('btn-apply-filters');
    if (applyBtn) {
      applyBtn.onclick = () => {
        this.filters.platform = document.getElementById('filter-platform').value;
        this.filters.fromDate = document.getElementById('filter-from-date').value;
        this.filters.toDate = document.getElementById('filter-to-date').value;
        this.loadData();
      };
    }

    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) {
      resetBtn.onclick = () => {
        this.filters = { platform: 'all', fromDate: '', toDate: '' };
        this.loadData();
      };
    }

    // Chart Metric Toggles
    const metricBtns = this.container.querySelectorAll('.metric-btn');
    metricBtns.forEach((btn) => {
      btn.onclick = () => {
        this.activeChartMetric = btn.getAttribute('data-metric');
        const chartContainer = document.getElementById('chart-container');
        const timelineData = (this.postsData.length > 0 && this.postAnalyticsMap[this.postsData[0]?.internalPostId]?.timeline) || [];
        if (chartContainer) {
          chartContainer.innerHTML = renderPerformanceChart(timelineData, this.activeChartMetric);
          this.attachEvents();
        }
      };
    });

    // Table Row click -> Open Details Modal
    const rows = this.container.querySelectorAll('.post-row');
    rows.forEach((row) => {
      row.onclick = async () => {
        const postId = row.getAttribute('data-post-id');
        this.selectedPost = this.postsData.find(
          (p) => p.internalPostId === postId || p.providerPostId === postId
        ) || { internalPostId: postId, caption: 'Selected Post' };

        this.selectedPostAnalytics = this.postAnalyticsMap[postId] || null;

        if (!this.selectedPostAnalytics) {
          try {
            this.selectedPostAnalytics = await analyticsApi.fetchPostAnalytics(postId);
          } catch {
            this.selectedPostAnalytics = null;
          }
        }

        const modalContainer = document.getElementById('modal-container');
        if (modalContainer) {
          modalContainer.innerHTML = renderPostDetailsModal(this.selectedPost, this.selectedPostAnalytics);
          this.attachEvents();
        }
      };
    });

    // Close Modal Button
    const closeBtn = document.getElementById('btn-close-modal');
    if (closeBtn) {
      closeBtn.onclick = () => {
        this.selectedPost = null;
        this.selectedPostAnalytics = null;
        const modalContainer = document.getElementById('modal-container');
        if (modalContainer) modalContainer.innerHTML = '';
      };
    }
  }
}
