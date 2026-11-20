import request from 'supertest';
import { createApp } from '../src/app';
import { ZernioAnalyticsProvider, calculateEngagementRate } from '../src/social/providers/zernio/zernio.analytics';
import { AnalyticsService } from '../src/social/services/analytics.service';
import { AnalyticsRepositoryService } from '../src/social/services/analytics-repository.service';
import { PostRepositoryService } from '../src/social/services/post-repository.service';
import { SocialPublishingError } from '../src/social/types/publisher.types';

describe('Analytics Layer Unit & Integration Tests', () => {
  describe('calculateEngagementRate', () => {
    test('calculates correct engagement rate based on reach', () => {
      const rate = calculateEngagementRate({
        reach: 1000,
        impressions: 1200,
        likes: 50,
        comments: 10,
        shares: 5,
        clicks: 15,
        views: 100,
      });
      // (50 + 10 + 5 + 15) / 1000 * 100 = 8.00%
      expect(rate).toBe(8);
    });

    test('falls back to impressions when reach is 0', () => {
      const rate = calculateEngagementRate({
        reach: 0,
        impressions: 500,
        likes: 10,
        comments: 5,
        shares: 0,
        clicks: 5,
      });
      // (10 + 5 + 5) / 500 * 100 = 4.00%
      expect(rate).toBe(4);
    });

    test('returns 0 when both reach and impressions are 0', () => {
      const rate = calculateEngagementRate({
        reach: 0,
        impressions: 0,
        likes: 10,
        comments: 5,
        shares: 0,
        clicks: 5,
      });
      expect(rate).toBe(0);
    });
  });

  describe('ZernioAnalyticsProvider', () => {
    let mockZernioClient: any;
    let provider: ZernioAnalyticsProvider;

    beforeEach(() => {
      mockZernioClient = {
        getAnalytics: jest.fn(),
        getPostTimeline: jest.fn(),
        getDailyMetrics: jest.fn(),
      };
      provider = new ZernioAnalyticsProvider(mockZernioClient);
    });

    test('getPostAnalytics returns normalized metrics with reactionBreakdown null when unsupported', async () => {
      mockZernioClient.getAnalytics.mockResolvedValueOnce({
        posts: [
          {
            _id: 'zernio_post_100',
            platform: 'facebook',
            platformPostUrl: 'https://facebook.com/post_100',
            analytics: {
              impressions: 1500,
              reach: 1200,
              likes: 80,
              comments: 12,
              shares: 9,
              saves: 2,
              clicks: 23,
              views: 0,
            },
          },
        ],
      });

      mockZernioClient.getPostTimeline.mockResolvedValueOnce({
        timeline: [
          {
            date: '2026-09-24',
            impressions: 1500,
            reach: 1200,
            likes: 80,
            comments: 12,
            shares: 9,
            saves: 2,
            clicks: 23,
            views: 0,
          },
        ],
      });

      const result = await provider.getPostAnalytics('zernio_post_100');

      expect(result).not.toBeNull();
      expect(result?.postId).toBe('zernio_post_100');
      expect(result?.platform).toBe('facebook');
      expect(result?.metrics.impressions).toBe(1500);
      expect(result?.metrics.reach).toBe(1200);
      expect(result?.metrics.likes).toBe(80);
      expect(result?.metrics.engagementRate).toBeGreaterThan(0);
      expect(result?.reactionBreakdown).toBeNull();
      expect(result?.timeline.length).toBe(1);
    });

    test('getPostAnalytics handles reactionBreakdown when provided by upstream API', async () => {
      mockZernioClient.getAnalytics.mockResolvedValueOnce({
        posts: [
          {
            _id: 'zernio_post_200',
            platform: 'facebook',
            analytics: {
              impressions: 2000,
              reach: 1500,
              likes: 100,
              comments: 20,
              shares: 10,
              clicks: 30,
              views: 0,
              reactionBreakdown: {
                like: 70,
                love: 20,
                haha: 5,
                wow: 3,
                sad: 1,
                angry: 1,
              },
            },
          },
        ],
      });

      mockZernioClient.getPostTimeline.mockResolvedValueOnce({ timeline: [] });

      const result = await provider.getPostAnalytics('zernio_post_200');

      expect(result?.reactionBreakdown).toEqual({
        like: 70,
        love: 20,
        haha: 5,
        wow: 3,
        sad: 1,
        angry: 1,
      });
    });

    test('getOverview calculates aggregated analytics across platforms', async () => {
      mockZernioClient.getDailyMetrics.mockResolvedValueOnce({
        platformBreakdown: [
          {
            platform: 'facebook',
            postCount: 5,
            impressions: 5000,
            reach: 4000,
            likes: 200,
            comments: 50,
            shares: 30,
            clicks: 80,
            views: 0,
          },
        ],
      });

      mockZernioClient.getAnalytics.mockResolvedValueOnce({
        overview: { totalPosts: 5 },
      });

      const overview = await provider.getOverview();

      expect(overview.totalPosts).toBe(5);
      expect(overview.impressions).toBe(5000);
      expect(overview.reach).toBe(4000);
      expect(overview.likes).toBe(200);
      expect(overview.engagementRate).toBeGreaterThan(0);
    });

    test('getPostAnalytics builds platformBreakdown and engagementActivity from raw Zernio data', async () => {
      mockZernioClient.getAnalytics.mockResolvedValueOnce({
        posts: [
          {
            _id: 'zernio_post_breakdown_1',
            platform: 'facebook',
            platforms: [
              { platform: 'facebook', platformPostId: 'fb_act_123', status: 'published' },
              { platform: 'instagram', platformPostId: 'ig_act_123', status: 'published' },
            ],
            analytics: {
              impressions: 1200,
              reach: 900,
              likes: 45,
              comments: 8,
              shares: 3,
              saves: 1,
              clicks: 12,
              views: 0,
            },
            comments: [
              {
                id: 'c_1',
                userName: 'Sarah Jenkins',
                type: 'comment',
                message: 'Great campaign!',
                createdAt: '2026-11-15T10:00:00.000Z',
              },
            ],
            reactions: [
              {
                id: 'r_1',
                actorName: 'Alex Rivera',
                reactionType: 'love',
                createdAt: '2026-11-15T11:00:00.000Z',
              },
            ],
          },
        ],
      });

      mockZernioClient.getPostTimeline.mockResolvedValueOnce({ timeline: [] });

      const result = await provider.getPostAnalytics('zernio_post_breakdown_1');

      expect(result).not.toBeNull();
      expect(result?.platformBreakdown).toBeDefined();
      expect(result?.platformBreakdown?.length).toBe(6);

      const fb = result?.platformBreakdown?.find((p) => p.platform === 'facebook');
      const ig = result?.platformBreakdown?.find((p) => p.platform === 'instagram');
      const x = result?.platformBreakdown?.find((p) => p.platform === 'x');

      expect(fb?.status).toBe('published');
      expect(ig?.status).toBe('published');
      expect(x?.status).toBe('not_targeted');

      expect(result?.engagementActivity).toBeDefined();
      expect(result?.engagementActivity?.length).toBe(2);
      expect(result?.engagementActivity?.[0].actorName).toBe('Sarah Jenkins');
      expect(result?.engagementActivity?.[0].actorType).toBe('user');
      expect(result?.engagementActivity?.[0].actionType).toBe('comment');
      expect(result?.engagementActivity?.[1].actorName).toBe('Alex Rivera');
      expect(result?.engagementActivity?.[1].actorType).toBe('user');
      expect(result?.engagementActivity?.[1].actionType).toBe('love');
    });

    test('getPostAnalytics matches by latePostId and composite Facebook post ID, extracting platform metrics', async () => {
      mockZernioClient.getAnalytics.mockResolvedValueOnce({
        posts: [
          {
            _id: '6afca7d8ef959f779bd84352',
            latePostId: '6afc8a7b988b7ba8ba61efe4',
            caption: 'post at 11:13 pm',
            platforms: [
              {
                platform: 'facebook',
                status: 'published',
                platformPostId: '1181717618348521_122123709693333427',
                accountId: '6ab3ef6b8d284ffb21357563',
                analytics: {
                  impressions: 8,
                  reach: 2,
                  likes: 2,
                  comments: 1,
                  shares: 0,
                  saves: 0,
                  clicks: 2,
                  views: 0,
                },
              },
            ],
          },
        ],
      });

      mockZernioClient.getPostTimeline.mockResolvedValueOnce({ timeline: [] });

      // Match via latePostId
      const resultByLateId = await provider.getPostAnalytics('6afc8a7b988b7ba8ba61efe4');
      expect(resultByLateId).not.toBeNull();
      expect(resultByLateId?.metrics.impressions).toBe(8);
      expect(resultByLateId?.metrics.reach).toBe(2);
      expect(resultByLateId?.metrics.likes).toBe(2);
      expect(resultByLateId?.metrics.comments).toBe(1);
      expect(resultByLateId?.metrics.clicks).toBe(2);

      // Match via bare Facebook platform post ID
      mockZernioClient.getAnalytics.mockResolvedValueOnce({
        posts: [
          {
            _id: '6afca7d8ef959f779bd84352',
            latePostId: '6afc8a7b988b7ba8ba61efe4',
            platforms: [
              {
                platform: 'facebook',
                status: 'published',
                platformPostId: '1181717618348521_122123709693333427',
                analytics: {
                  impressions: 15,
                  reach: 10,
                  likes: 3,
                  comments: 0,
                  shares: 0,
                  saves: 0,
                  clicks: 1,
                  views: 0,
                },
              },
            ],
          },
        ],
      });
      mockZernioClient.getPostTimeline.mockResolvedValueOnce({ timeline: [] });

      const resultByBareFbId = await provider.getPostAnalytics('122123709693333427');
      expect(resultByBareFbId).not.toBeNull();
      expect(resultByBareFbId?.metrics.impressions).toBe(15);
      expect(resultByBareFbId?.metrics.reach).toBe(10);
    });

    test('getPostAnalytics does not fabricate metrics from timeline when post metrics are zero', async () => {
      mockZernioClient.getAnalytics.mockResolvedValueOnce({
        posts: [
          {
            _id: 'post_with_zero_raw',
            latePostId: 'late_zero_1',
            analytics: {
              impressions: 0,
              reach: 0,
              likes: 0,
              comments: 0,
              shares: 0,
              saves: 0,
              clicks: 0,
              views: 0,
            },
            platforms: [{ platform: 'facebook', platformPostId: 'fb_zero_1' }],
          },
        ],
      });

      mockZernioClient.getPostTimeline.mockResolvedValueOnce({
        timeline: [
          {
            date: '2026-11-17',
            impressions: 8,
            reach: 2,
            likes: 2,
            comments: 1,
            shares: 0,
            saves: 0,
            clicks: 2,
            views: 0,
          },
        ],
      });

      const result = await provider.getPostAnalytics('late_zero_1');
      expect(result).not.toBeNull();
      // Honest post metrics: zero is not replaced by timeline points
      expect(result?.metrics.impressions).toBe(0);
      expect(result?.metrics.reach).toBe(0);
      expect(result?.metrics.likes).toBe(0);
      expect(result?.metrics.clicks).toBe(0);
      // Timeline points are preserved for charting
      expect(result?.timeline.length).toBe(1);
    });
  });

  describe('AnalyticsService & Caching', () => {
    let mockProvider: any;
    let repoCache: AnalyticsRepositoryService;
    let postRepo: PostRepositoryService;
    let service: AnalyticsService;

    beforeEach(() => {
      mockProvider = {
        getPostAnalytics: jest.fn(),
        getPostTimeline: jest.fn(),
        getOverview: jest.fn(),
      };
      repoCache = new AnalyticsRepositoryService(300);
      postRepo = new PostRepositoryService();
      service = new AnalyticsService(mockProvider, repoCache, postRepo);
    });

    test('caches analytics responses and prevents duplicate upstream API calls', async () => {
      mockProvider.getPostAnalytics.mockResolvedValueOnce({
        postId: 'post_cached_1',
        platform: 'facebook',
        metrics: { impressions: 100, reach: 90, likes: 10, comments: 2, shares: 1, saves: 0, clicks: 5, views: 0, engagementRate: 20 },
        reactionBreakdown: null,
        timeline: [],
        fetchedAt: new Date().toISOString(),
      });

      const res1 = await service.getPostAnalytics('post_cached_1');
      const res2 = await service.getPostAnalytics('post_cached_1');

      expect(res1).toEqual(res2);
      expect(mockProvider.getPostAnalytics).toHaveBeenCalledTimes(1);
    });

    test('distinguishes "no data yet" for locally published posts vs 404 for unknown posts', async () => {
      // Create a local post in postRepo
      postRepo.save({
        internalPostId: 'internal_post_123',
        idempotencyKey: 'req_123',
        publishNow: true,
        platforms: [{ platform: 'facebook', status: 'published' }],
        caption: 'Test post',
        status: 'published',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      mockProvider.getPostAnalytics.mockResolvedValueOnce(null);

      // Local post present -> returns "no_data_yet" status response gracefully
      const res = await service.getPostAnalytics('internal_post_123');
      expect(res.status).toBe('no_data_yet');
      expect(res.metrics.impressions).toBe(0);

      // Non-existent post -> throws 404
      mockProvider.getPostAnalytics.mockResolvedValueOnce(null);
      await expect(service.getPostAnalytics('unknown_post_xyz')).rejects.toThrow('Post analytics not found');
    });

    test('bypasses in-memory cache when forceRefresh is true for getPostAnalytics and getOverview', async () => {
      const mockPostAnalytics1 = {
        postId: 'post_bypass_1',
        platform: 'facebook',
        metrics: { impressions: 100, reach: 90, likes: 10, comments: 2, shares: 1, saves: 0, clicks: 5, views: 0, engagementRate: 20 },
        reactionBreakdown: null,
        timeline: [],
        fetchedAt: new Date().toISOString(),
      };
      const mockPostAnalytics2 = {
        ...mockPostAnalytics1,
        metrics: { ...mockPostAnalytics1.metrics, likes: 30 },
      };

      mockProvider.getPostAnalytics
        .mockResolvedValueOnce(mockPostAnalytics1)
        .mockResolvedValueOnce(mockPostAnalytics2);

      // Initial call populates cache
      const res1 = await service.getPostAnalytics('post_bypass_1');
      expect(res1.metrics.likes).toBe(10);
      expect(mockProvider.getPostAnalytics).toHaveBeenCalledTimes(1);

      // Calling with forceRefresh = false returns cached response
      const cachedRes = await service.getPostAnalytics('post_bypass_1');
      expect(cachedRes.metrics.likes).toBe(10);
      expect(mockProvider.getPostAnalytics).toHaveBeenCalledTimes(1);

      // Calling with forceRefresh = true bypasses cache and fetches fresh provider data
      const refreshedRes = await service.getPostAnalytics('post_bypass_1', true);
      expect(refreshedRes.metrics.likes).toBe(30);
      expect(mockProvider.getPostAnalytics).toHaveBeenCalledTimes(2);
    });

    test('getOverview aggregates metrics from owned published posts and rejects unauthenticated requests', async () => {
      const filter = { platform: 'facebook' };
      await expect(service.getOverview(filter, false, undefined)).rejects.toThrow(
        'Authentication required for analytics overview.'
      );

      // Save two published posts for user_1 and one for user_2
      await postRepo.save({
        internalPostId: 'p_u1_1',
        userId: 'user_1',
        idempotencyKey: 'key_u1_1',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await postRepo.save({
        internalPostId: 'p_u1_2',
        userId: 'user_1',
        idempotencyKey: 'key_u1_2',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      await postRepo.save({
        internalPostId: 'p_u2_1',
        userId: 'user_2',
        idempotencyKey: 'key_u2_1',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      mockProvider.getPostAnalytics.mockImplementation(async (id: string) => {
        if (id === 'p_u1_1') {
          return {
            postId: 'p_u1_1',
            platform: 'facebook',
            metrics: { impressions: 100, reach: 50, likes: 10, comments: 2, shares: 1, saves: 0, clicks: 5, views: 0, engagementRate: 36 },
            reactionBreakdown: null,
            timeline: [],
            fetchedAt: new Date().toISOString(),
          };
        }
        if (id === 'p_u1_2') {
          return {
            postId: 'p_u1_2',
            platform: 'facebook',
            metrics: { impressions: 200, reach: 100, likes: 20, comments: 4, shares: 2, saves: 0, clicks: 10, views: 0, engagementRate: 36 },
            reactionBreakdown: null,
            timeline: [],
            fetchedAt: new Date().toISOString(),
          };
        }
        if (id === 'p_u2_1') {
          return {
            postId: 'p_u2_1',
            platform: 'facebook',
            metrics: { impressions: 9999, reach: 9999, likes: 9999, comments: 9999, shares: 9999, saves: 9999, clicks: 9999, views: 9999, engagementRate: 100 },
            reactionBreakdown: null,
            timeline: [],
            fetchedAt: new Date().toISOString(),
          };
        }
        return null;
      });

      const res = await service.getOverview(filter, false, 'user_1');
      expect(res.success).toBe(true);
      expect(res.overview.totalPosts).toBe(2);
      expect(res.overview.impressions).toBe(300);
      expect(res.overview.reach).toBe(150);
      expect(res.overview.likes).toBe(30);
      expect(res.overview.comments).toBe(6);
      expect(res.overview.shares).toBe(3);
      expect(res.overview.clicks).toBe(15);
      // User 2's metrics must NOT be included in user 1's overview!
      expect(res.overview.impressions).not.toBeGreaterThanOrEqual(9999);
      // mockProvider.getPostAnalytics was never called with p_u2_1 for user_1
      expect(mockProvider.getPostAnalytics).not.toHaveBeenCalledWith('p_u2_1');
      // Upstream global overview was never called
      expect(mockProvider.getOverview).not.toHaveBeenCalled();
    });

    test('getPostTimeline does NOT cache an empty timeline array', async () => {
      // First call: provider returns empty array
      mockProvider.getPostTimeline.mockResolvedValueOnce([]);

      const res1 = await service.getPostTimeline('post_empty_tl');
      expect(res1.timeline).toEqual([]);
      expect(mockProvider.getPostTimeline).toHaveBeenCalledTimes(1);

      // Cache should remain empty
      expect(repoCache.getTimeline('post_empty_tl')).toBeNull();

      // Second call: provider returns populated timeline
      const populatedTimeline = [
        { date: '2026-09-24', impressions: 150, reach: 120, likes: 10, comments: 2, shares: 1, saves: 0, clicks: 3, views: 0, engagementRate: 10.83 },
      ];
      mockProvider.getPostTimeline.mockResolvedValueOnce(populatedTimeline);

      const res2 = await service.getPostTimeline('post_empty_tl');
      expect(res2.timeline).toEqual(populatedTimeline);
      expect(mockProvider.getPostTimeline).toHaveBeenCalledTimes(2);

      // Third call without forceRefresh: should now be served from cache
      const res3 = await service.getPostTimeline('post_empty_tl');
      expect(res3.timeline).toEqual(populatedTimeline);
      expect(mockProvider.getPostTimeline).toHaveBeenCalledTimes(2);
    });

    test('getPostAnalytics merges localPost platforms into platformBreakdown and does NOT create synthetic activity from timeline deltas', async () => {
      postRepo.save({
        internalPostId: 'post_multi_platform_1',
        idempotencyKey: 'req_mp_1',
        publishNow: true,
        platforms: [
          { platform: 'facebook', status: 'published', platformPostId: 'fb_p_1' },
          { platform: 'instagram', status: 'published', platformPostId: 'ig_p_1' },
        ],
        caption: 'Multi-platform campaign post',
        status: 'published',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      mockProvider.getPostAnalytics.mockResolvedValueOnce({
        postId: 'post_multi_platform_1',
        platform: 'facebook',
        platformPostId: 'fb_p_1',
        metrics: { impressions: 1000, reach: 800, likes: 25, comments: 4, shares: 2, saves: 1, clicks: 10, views: 0, engagementRate: 4.1 },
        reactionBreakdown: null,
        timeline: [
          { date: '2026-11-10', impressions: 500, reach: 400, likes: 10, comments: 1, shares: 0, saves: 0, clicks: 5, views: 0, engagementRate: 3.2 },
          { date: '2026-11-11', impressions: 1000, reach: 800, likes: 25, comments: 4, shares: 2, saves: 1, clicks: 10, views: 0, engagementRate: 4.1 },
        ],
        fetchedAt: new Date().toISOString(),
      });

      const res = await service.getPostAnalytics('post_multi_platform_1');

      expect(res.platformBreakdown).toBeDefined();
      expect(Array.isArray(res.platformBreakdown)).toBe(true);

      const fb = res.platformBreakdown.find((p: any) => p.platform === 'facebook');
      const ig = res.platformBreakdown.find((p: any) => p.platform === 'instagram');
      const tiktok = res.platformBreakdown.find((p: any) => p.platform === 'tiktok');

      expect(fb?.status).toBe('published');
      expect(ig?.status).toBe('published');
      expect(tiktok?.status).toBe('not_targeted');

      // Verified: no synthetic activity created from timeline deltas
      expect(res.engagementActivity).toBeDefined();
      expect(res.engagementActivity).toEqual([]);
    });

    test('getPostAnalytics preserves genuine provider-supplied engagementActivity and reactionBreakdown null', async () => {
      mockProvider.getPostAnalytics.mockResolvedValueOnce({
        postId: 'post_genuine_act_1',
        platform: 'facebook',
        metrics: { impressions: 120, reach: 90, likes: 5, comments: 1, shares: 0, saves: 0, clicks: 2, views: 0, engagementRate: 6.67 },
        reactionBreakdown: null,
        timeline: [{ date: '2026-11-17', impressions: 120, reach: 90, likes: 5, comments: 1, shares: 0, saves: 0, clicks: 2, views: 0, engagementRate: 6.67 }],
        engagementActivity: [
          {
            id: 'real_event_1',
            actorName: 'Real Supporter',
            actorType: 'user',
            platform: 'facebook',
            actionType: 'comment',
            reactionLabel: '💬 Comment',
            commentText: 'Awesome update!',
            timestamp: '2026-11-17T14:30:00.000Z',
          },
        ],
        fetchedAt: new Date().toISOString(),
      });

      const res = await service.getPostAnalytics('post_genuine_act_1');

      // reactionBreakdown must remain null, never converted to Like=all
      expect(res.reactionBreakdown).toBeNull();

      // genuine engagementActivity must be preserved as supplied
      expect(res.engagementActivity).toHaveLength(1);
      expect(res.engagementActivity[0].id).toBe('real_event_1');
      expect(res.engagementActivity[0].actorName).toBe('Real Supporter');
      expect(res.engagementActivity[0].timestamp).toBe('2026-11-17T14:30:00.000Z');
    });

    test('getPostAnalytics returns honest no_data_yet when upstream getPostAnalytics returns null without fabricating metrics from timeline', async () => {
      await postRepo.save({
        internalPostId: 'post_91476865-d074-4f43-947c-158f6b3b629a',
        userId: 'owner_user_1',
        idempotencyKey: 'idemp_legacy_post_1',
        caption: 'post at 11:13 pm',
        status: 'scheduled',
        scheduledFor: '2026-11-17T17:13:00.000Z',
        publishNow: false,
        providerPostId: '6afc8a7b988b7ba8ba61efe4',
        platforms: [
          {
            platform: 'facebook',
            status: 'scheduled',
            platformPostId: '1181717618348521_122123709693333427',
          },
        ],
        createdAt: '2026-11-17T17:10:00.000Z',
        updatedAt: '2026-11-17T17:10:00.000Z',
      });

      // Upstream getPostAnalytics returns null
      mockProvider.getPostAnalytics.mockResolvedValue(null);

      const res = await service.getPostAnalytics('post_91476865-d074-4f43-947c-158f6b3b629a', false, 'owner_user_1');

      // Honest no_data_yet status returned when provider metrics are unavailable
      expect(res.status).toBe('no_data_yet');
      expect(res.metrics.impressions).toBe(0);
      expect(res.metrics.reach).toBe(0);
      expect(res.metrics.likes).toBe(0);
    });

    test('getOverview includes past scheduled posts with provider IDs and aggregates their metrics', async () => {
      await postRepo.save({
        internalPostId: 'post_past_scheduled_1',
        userId: 'owner_user_2',
        idempotencyKey: 'idemp_sched_past_1',
        caption: 'Scheduled post that went live',
        status: 'scheduled',
        scheduledFor: '2026-11-17T17:13:00.000Z',
        publishNow: false,
        providerPostId: '6afc8a7b988b7ba8ba61efe4',
        platforms: [
          {
            platform: 'facebook',
            status: 'scheduled',
            platformPostId: '1181717618348521_122123709693333427',
          },
        ],
        createdAt: '2026-11-17T17:10:00.000Z',
        updatedAt: '2026-11-17T17:10:00.000Z',
      });

      mockProvider.getPostAnalytics.mockResolvedValueOnce({
        postId: '6afc8a7b988b7ba8ba61efe4',
        platform: 'facebook',
        metrics: {
          impressions: 63,
          reach: 45,
          likes: 12,
          comments: 3,
          shares: 1,
          saves: 0,
          clicks: 5,
          views: 0,
          engagementRate: 46.67,
        },
        reactionBreakdown: null,
        timeline: [],
        fetchedAt: new Date().toISOString(),
      });

      const overviewRes = await service.getOverview(undefined, false, 'owner_user_2');

      expect(overviewRes.success).toBe(true);
      expect(overviewRes.overview.totalPosts).toBe(1);
      expect(overviewRes.overview.impressions).toBe(63);
      expect(overviewRes.overview.reach).toBe(45);
      expect(overviewRes.overview.likes).toBe(12);
      expect(overviewRes.overview.clicks).toBe(5);
    });
  });

  describe('API Endpoints (supertest)', () => {
    let app: any;
    let mockAnalyticsService: any;

    let testPostRepo: PostRepositoryService;
    beforeEach(async () => {
      mockAnalyticsService = {
        getPostAnalytics: jest.fn(),
        getPostTimeline: jest.fn(),
        getOverview: jest.fn(),
      };
      testPostRepo = new PostRepositoryService();
      const testPostIds = ['p_123', 'p_refresh_test', 'p_breakdown_test'];
      for (const id of testPostIds) {
        await testPostRepo.save({
          internalPostId: id,
          userId: 'test-user',
          idempotencyKey: `key_${id}`,
          publishNow: true,
          status: 'published',
          platforms: [{ platform: 'facebook', status: 'published' }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      app = createApp(undefined, testPostRepo, mockAnalyticsService as any, { userId: 'test-user', role: 'owner' });
    });

    test('GET /api/social/analytics/overview returns aggregated metrics', async () => {
      mockAnalyticsService.getOverview.mockResolvedValueOnce({
        success: true,
        overview: {
          totalPosts: 10,
          impressions: 10000,
          reach: 8000,
          likes: 500,
          comments: 100,
          shares: 50,
          clicks: 200,
          views: 0,
          engagementRate: 10.63,
        },
      });

      const res = await request(app).get('/api/social/analytics/overview?platform=facebook');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.overview.totalPosts).toBe(10);
      expect(mockAnalyticsService.getOverview).toHaveBeenCalledWith(
        {
          platform: 'facebook',
          fromDate: undefined,
          toDate: undefined,
        },
        false,
        'test-user'
      );
    });

    test('GET /api/social/analytics/:postId returns post analytics', async () => {
      mockAnalyticsService.getPostAnalytics.mockResolvedValueOnce({
        postId: 'p_123',
        platform: 'facebook',
        metrics: {
          impressions: 1500,
          reach: 1200,
          likes: 80,
          comments: 12,
          shares: 9,
          clicks: 23,
          views: 0,
          engagementRate: 10.33,
        },
        reactionBreakdown: null,
        timeline: [],
      });

      const res = await request(app).get('/api/social/analytics/p_123');

      expect(res.status).toBe(200);
      expect(res.body.postId).toBe('p_123');
      expect(res.body.metrics.likes).toBe(80);
      expect(res.body.reactionBreakdown).toBeNull();
    });

    test('GET /api/social/analytics/:postId/timeline returns timeline data', async () => {
      mockAnalyticsService.getPostTimeline.mockResolvedValueOnce({
        postId: 'p_123',
        timeline: [
          { date: '2026-09-24', impressions: 100, reach: 90, likes: 5, comments: 1, shares: 0, saves: 0, clicks: 2, views: 0, engagementRate: 8.89 },
        ],
      });

      const res = await request(app).get('/api/social/analytics/p_123/timeline');

      expect(res.status).toBe(200);
      expect(res.body.postId).toBe('p_123');
      expect(res.body.timeline.length).toBe(1);
    });

    test('GET /api/social/analytics/:postId returns 404 for invalid post', async () => {
      mockAnalyticsService.getPostAnalytics.mockRejectedValueOnce(
        new SocialPublishingError('Post analytics not found for ID: unknown', 404)
      );

      const res = await request(app).get('/api/social/analytics/unknown');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
    });

    test('GET /api/social/analytics/overview?platform=facebook&refresh=true passes forceRefresh true to getOverview', async () => {
      mockAnalyticsService.getOverview.mockResolvedValueOnce({
        success: true,
        overview: { totalPosts: 12 },
      });

      const res = await request(app).get('/api/social/analytics/overview?platform=facebook&refresh=true');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockAnalyticsService.getOverview).toHaveBeenCalledWith(
        {
          platform: 'facebook',
          fromDate: undefined,
          toDate: undefined,
        },
        true,
        'test-user'
      );
    });

    test('GET /api/social/analytics/:postId?refresh=true passes forceRefresh true to getPostAnalytics', async () => {
      mockAnalyticsService.getPostAnalytics.mockResolvedValueOnce({
        postId: 'p_refresh_test',
        platform: 'facebook',
        metrics: { impressions: 100 },
      });

      const res = await request(app).get('/api/social/analytics/p_refresh_test?refresh=true');

      expect(res.status).toBe(200);
      expect(mockAnalyticsService.getPostAnalytics).toHaveBeenCalledWith('p_refresh_test', true, 'test-user');
    });

    test('GET /api/social/analytics/:postId/timeline?refresh=1 passes forceRefresh true to getPostTimeline', async () => {
      mockAnalyticsService.getPostTimeline.mockResolvedValueOnce({
        postId: 'p_refresh_test',
        timeline: [],
      });

      const res = await request(app).get('/api/social/analytics/p_refresh_test/timeline?refresh=1');

      expect(res.status).toBe(200);
      expect(mockAnalyticsService.getPostTimeline).toHaveBeenCalledWith('p_refresh_test', true, 'test-user');
    });

    test('GET /api/social/analytics/:postId returns platformBreakdown and engagementActivity in response', async () => {
      mockAnalyticsService.getPostAnalytics.mockResolvedValueOnce({
        postId: 'p_breakdown_test',
        platform: 'facebook',
        metrics: { impressions: 100, reach: 90, likes: 10, comments: 2, shares: 1, saves: 0, clicks: 5, views: 0, engagementRate: 20 },
        reactionBreakdown: { like: 8, love: 2, haha: 0, wow: 0, sad: 0, angry: 0 },
        timeline: [],
        platformBreakdown: [
          { platform: 'facebook', status: 'published', metrics: { impressions: 100, reach: 90, likes: 10, comments: 2, shares: 1, saves: 0, clicks: 5, views: 0, engagementRate: 20 } },
          { platform: 'instagram', status: 'not_targeted', metrics: { impressions: 0, reach: 0, likes: 0, comments: 0, shares: 0, saves: 0, clicks: 0, views: 0, engagementRate: 0 } },
        ],
        engagementActivity: [
          {
            id: 'act_1',
            actorName: 'Community Member',
            actorType: 'user',
            platform: 'facebook',
            actionType: 'like',
            reactionLabel: '👍 Like',
            timestamp: '2026-11-15T10:00:00.000Z',
          },
        ],
      });

      const res = await request(app).get('/api/social/analytics/p_breakdown_test');

      expect(res.status).toBe(200);
      expect(res.body.platformBreakdown).toBeDefined();
      expect(res.body.platformBreakdown.length).toBe(2);
      expect(res.body.platformBreakdown[0].platform).toBe('facebook');
      expect(res.body.engagementActivity).toBeDefined();
      expect(res.body.engagementActivity.length).toBe(1);
      expect(res.body.engagementActivity[0].actionType).toBe('like');
    });
  });
});
