export function renderPostPerformanceTable(posts = [], postAnalyticsMap = {}) {
  if (!posts || posts.length === 0) {
    return `
      <div class="table-card">
        <h3 style="font-size: 1.1rem; font-weight: 600; margin-bottom: 1rem;">Post Performance Log</h3>
        <div class="empty-state">
          <div class="state-icon">📝</div>
          <p>No published social posts found.</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="table-card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem;">
        <h3 style="font-size: 1.1rem; font-weight: 600;">Post Performance Log</h3>
        <span style="font-size: 0.8rem; color: var(--text-muted);">${posts.length} Posts Tracked</span>
      </div>

      <div class="table-responsive">
        <table class="posts-table">
          <thead>
            <tr>
              <th>Post</th>
              <th>Platform</th>
              <th>Status</th>
              <th>Reach</th>
              <th>Impressions</th>
              <th>Likes</th>
              <th>Comments</th>
              <th>Shares</th>
              <th>Engagement Rate</th>
            </tr>
          </thead>
          <tbody>
            ${posts
              .map((p) => {
                const postId = p.internalPostId || p.providerPostId || p.postId || p._id;
                const analyticsData = postAnalyticsMap[postId] || {};
                const metrics = analyticsData.metrics || {};
                const platform = (p.platforms && p.platforms[0]?.platform) || p.platform || 'facebook';

                const reach = typeof metrics.reach === 'number' ? metrics.reach.toLocaleString() : (metrics.reach ?? '-');
                const impressions = typeof metrics.impressions === 'number' ? metrics.impressions.toLocaleString() : (metrics.impressions ?? '-');
                const likes = typeof metrics.likes === 'number' ? metrics.likes.toLocaleString() : (metrics.likes ?? '-');
                const comments = typeof metrics.comments === 'number' ? metrics.comments.toLocaleString() : (metrics.comments ?? '-');
                const shares = typeof metrics.shares === 'number' ? metrics.shares.toLocaleString() : (metrics.shares ?? '-');
                const rate = typeof metrics.engagementRate === 'number' ? `${metrics.engagementRate.toFixed(2)}%` : '-';

                const thumbnail = p.imageUrl || p.thumbnailUrl || 'https://picsum.photos/100/100?random=' + postId;

                return `
                  <tr class="post-row" data-post-id="${postId}">
                    <td style="display: flex; align-items: center; gap: 0.75rem;">
                      <img src="${thumbnail}" class="post-thumbnail" alt="Post thumbnail" onerror="this.src='https://via.placeholder.com/42?text=FB';">
                      <div class="post-caption-cell" title="${p.caption || 'No caption'}">
                        ${p.caption || '(No caption text)'}
                      </div>
                    </td>
                    <td>
                      <span class="badge-platform">${platform}</span>
                    </td>
                    <td>
                      <span class="status-${p.status || 'published'}">${(p.status || 'published').toUpperCase()}</span>
                    </td>
                    <td><strong>${reach}</strong></td>
                    <td>${impressions}</td>
                    <td>${likes}</td>
                    <td>${comments}</td>
                    <td>${shares}</td>
                    <td><span style="color: var(--accent-success); font-weight: 600;">${rate}</span></td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
