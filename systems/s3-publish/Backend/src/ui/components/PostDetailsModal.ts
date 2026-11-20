import { renderReactionBreakdown } from './ReactionBreakdown';
import { renderPerformanceChart } from './PerformanceChart';

export function renderPostDetailsModal(postData: any, analyticsData: any): string {
  if (!postData && !analyticsData) return '';

  const postId = analyticsData?.postId || postData?.internalPostId || 'N/A';
  const platform = analyticsData?.platform || postData?.platforms?.[0]?.platform || 'facebook';
  const caption = postData?.caption || 'Social post';
  const publishDate = postData?.createdAt ? new Date(postData.createdAt).toLocaleString() : 'N/A';
  const metrics = analyticsData?.metrics || {};
  const timeline = analyticsData?.timeline || [];
  const reactionBreakdown = analyticsData?.reactionBreakdown || null;

  return `
    <div class="modal-overlay" id="post-details-modal">
      <div class="modal-content">
        <button class="modal-close" id="btn-close-modal">&times;</button>

        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem;">
          <span class="badge-platform">${platform}</span>
          <span style="font-size: 0.85rem; color: var(--text-muted);">Published: ${publishDate}</span>
          <span style="font-size: 0.85rem; color: var(--text-dim); margin-left: auto;">ID: ${postId}</span>
        </div>

        <h3 style="font-size: 1.15rem; font-weight: 600; margin-bottom: 1.25rem; color: var(--text-main); line-height: 1.4;">
          ${caption}
        </h3>

        ${
          postData?.imageUrl
            ? `<div style="margin-bottom: 1.25rem;"><img src="${postData.imageUrl}" style="max-height: 220px; border-radius: 8px; object-fit: cover;" alt="Post media"></div>`
            : ''
        }

        <!-- Metrics Grid -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.75rem; margin-bottom: 1.5rem;">
          <div class="reaction-card">
            <div class="reaction-name">Impressions</div>
            <div class="reaction-count">${metrics.impressions ?? 0}</div>
          </div>
          <div class="reaction-card">
            <div class="reaction-name">Reach</div>
            <div class="reaction-count" style="color: var(--accent-primary);">${metrics.reach ?? 0}</div>
          </div>
          <div class="reaction-card">
            <div class="reaction-name">Likes</div>
            <div class="reaction-count">${metrics.likes ?? 0}</div>
          </div>
          <div class="reaction-card">
            <div class="reaction-name">Comments</div>
            <div class="reaction-count">${metrics.comments ?? 0}</div>
          </div>
          <div class="reaction-card">
            <div class="reaction-name">Shares</div>
            <div class="reaction-count">${metrics.shares ?? 0}</div>
          </div>
          <div class="reaction-card">
            <div class="reaction-name">Clicks</div>
            <div class="reaction-count">${metrics.clicks ?? 0}</div>
          </div>
          <div class="reaction-card">
            <div class="reaction-name">Views</div>
            <div class="reaction-count">${metrics.views ?? 0}</div>
          </div>
          <div class="reaction-card">
            <div class="reaction-name">Engagement Rate</div>
            <div class="reaction-count" style="color: var(--accent-success);">
              ${typeof metrics.engagementRate === 'number' ? `${metrics.engagementRate.toFixed(2)}%` : '0%'}
            </div>
          </div>
        </div>

        <!-- Reaction Breakdown Section -->
        ${renderReactionBreakdown(reactionBreakdown, metrics.likes || 0)}

        <!-- Performance Timeline Chart -->
        <div style="margin-top: 1.5rem;">
          ${renderPerformanceChart(timeline, 'reach')}
        </div>
      </div>
    </div>
  `;
}
