export const analyticsApi = {
  async fetchOverview(filters = {}, refresh = false) {
    const query = new URLSearchParams();
    if (filters.platform && filters.platform !== 'all') {
      query.append('platform', filters.platform);
    }
    if (filters.fromDate) {
      query.append('fromDate', filters.fromDate);
    }
    if (filters.toDate) {
      query.append('toDate', filters.toDate);
    }
    if (refresh || filters.refresh) {
      query.append('refresh', 'true');
    }

    const url = `/api/social/analytics/overview${query.toString() ? '?' + query.toString() : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch analytics overview (${res.status})`);
    }
    return res.json();
  },

  async fetchPostAnalytics(postId, refresh = false) {
    const query = refresh ? '?refresh=true' : '';
    const res = await fetch(`/api/social/analytics/${encodeURIComponent(postId)}${query}`);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch post analytics (${res.status})`);
    }
    return res.json();
  },

  async fetchPostTimeline(postId, refresh = false) {
    const query = refresh ? '?refresh=true' : '';
    const res = await fetch(`/api/social/analytics/${encodeURIComponent(postId)}/timeline${query}`);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch post timeline (${res.status})`);
    }
    return res.json();
  },

  async fetchPublishedPosts() {
    const res = await fetch('/api/social/posts');
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to fetch published posts (${res.status})`);
    }
    return res.json();
  },
};
