import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const apiClient = axios.create({
  baseURL: `${BASE_URL}/api/social`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const authClient = axios.create({
  baseURL: `${BASE_URL}/api/auth`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const apiService = {
  // 1. Publish Post
  publishPost: async (postData) => {
    const response = await apiClient.post('/publish', postData);
    return response.data;
  },

  // 2. Get All Posts
  getPosts: async () => {
    const response = await apiClient.get('/posts');
    return response.data;
  },

  // 3. Get Post by ID
  getPostById: async (id) => {
    const response = await apiClient.get(`/posts/${id}`);
    return response.data;
  },

  // 4. Verify Auth / Accounts
  verifyAuth: async () => {
    const response = await apiClient.get('/auth/verify');
    return response.data;
  },

  // 5. Analytics Overview
  getOverview: async (params = {}, refresh = false) => {
    const finalParams = { ...params };
    if (refresh) {
      finalParams.refresh = true;
    }
    const response = await apiClient.get('/analytics/overview', { params: finalParams });
    return response.data;
  },

  // 6. Post Analytics
  getPostAnalytics: async (postId, refresh = false) => {
    const params = typeof refresh === 'boolean' ? (refresh ? { refresh: true } : {}) : refresh;
    const response = await apiClient.get(`/analytics/${postId}`, { params });
    return response.data;
  },

  // 7. Post Timeline
  getPostTimeline: async (postId, refresh = false) => {
    const params = typeof refresh === 'boolean' ? (refresh ? { refresh: true } : {}) : refresh;
    const response = await apiClient.get(`/analytics/${postId}/timeline`, { params });
    return response.data;
  },

  // 8. User Connected Accounts
  getAccounts: async () => {
    const response = await apiClient.get('/accounts');
    return response.data;
  },

  disconnectAccount: async (accountId) => {
    const response = await apiClient.delete(`/accounts/${accountId}`);
    return response.data;
  },

  // 9. Social Connect Flow (Zernio hosted authorization)
  getConnectUrl: async (platform, redirectUrl) => {
    const params = redirectUrl ? { redirect_url: redirectUrl } : {};
    const response = await apiClient.get(`/connect/${platform}`, { params });
    return response.data;
  },

  completeConnectCallback: async (callbackData) => {
    const response = await apiClient.post('/connect/callback', callbackData);
    return response.data;
  },

  // 10. Post Comments
  getPostComments: async (postId, cursor = null, limit = 25) => {
    const params = {};
    if (cursor) params.cursor = cursor;
    if (limit) params.limit = limit;
    const response = await apiClient.get(`/posts/${postId}/comments`, { params });
    return response.data;
  },

  // 11. Post Reactions (Facebook per-type reaction counts)
  getPostReactions: async (postId) => {
    const response = await apiClient.get(`/posts/${postId}/reactions`);
    return response.data;
  },

  // 12. Campaign Link Tracking
  getTrackingStats: async () => {
    const response = await apiClient.get('/tracking/stats');
    return response.data;
  },

  getTrackingProducts: async () => {
    const response = await apiClient.get('/tracking/products');
    return response.data;
  },

  createTrackingProduct: async (data) => {
    const response = await apiClient.post('/tracking/products', data);
    return response.data;
  },

  getTrackingCampaigns: async (productId) => {
    const params = productId ? { productId } : {};
    const response = await apiClient.get('/tracking/campaigns', { params });
    return response.data;
  },

  createTrackingCampaign: async (data) => {
    const response = await apiClient.post('/tracking/campaigns', data);
    return response.data;
  },

  getTrackingLinks: async (campaignId) => {
    const params = campaignId ? { campaignId } : {};
    const response = await apiClient.get('/tracking/links', { params });
    return response.data;
  },

  createTrackingLink: async (data) => {
    const response = await apiClient.post('/tracking/links', data);
    return response.data;
  },

  // 13. Website Activity Tracking (Phase 2)
  getTrackingWebsites: async () => {
    const response = await apiClient.get('/tracking/websites');
    return response.data;
  },

  registerTrackingWebsite: async (data) => {
    const response = await apiClient.post('/tracking/websites', data);
    return response.data;
  },

  getWebsiteTrackingStats: async (websiteId = null) => {
    const params = websiteId ? { websiteId } : {};
    const response = await apiClient.get('/tracking/website-stats', { params });
    return response.data;
  },

  // --- Auth ---

  getCurrentUser: async () => {
    const response = await authClient.get('/me');
    return response.data;
  },

  login: async (email, password) => {
    const response = await authClient.post('/login', { email, password });
    return response.data;
  },

  signup: async (email, password) => {
    const response = await authClient.post('/signup', { email, password });
    return response.data;
  },

  logout: async () => {
    const response = await authClient.post('/logout');
    return response.data;
  },

  ownerSetup: async (setupToken, email, password) => {
    const response = await authClient.post('/owner-setup', { setupToken, email, password });
    return response.data;
  },
};
