import { PostRepositoryService } from '../src/social/services/post-repository.service';
import { PublisherService } from '../src/social/services/publisher.service';
import { AnalyticsService } from '../src/social/services/analytics.service';
import { PlatformRouter } from '../src/social/router/platform.router';
import { ZernioPublisher } from '../src/social/providers/zernio/zernio.publisher';
import { SocialAnalyticsProvider } from '../src/social/types/analytics.types';
import { PostRecord } from '../src/social/types/publisher.types';
import { closePool } from '../src/db';

describe('Post Identity Mapping & Persistence Tests', () => {
  let postRepo: PostRepositoryService;
  let platformRouter: PlatformRouter;
  let mockZernioPublisher: jest.Mocked<ZernioPublisher>;
  let publisherService: PublisherService;
  let mockAnalyticsProvider: jest.Mocked<SocialAnalyticsProvider>;
  let analyticsService: AnalyticsService;

  beforeEach(async () => {
    postRepo = new PostRepositoryService();
    await postRepo.clear();

    platformRouter = new PlatformRouter();
    mockZernioPublisher = {
      publish: jest.fn(),
    } as any;

    publisherService = new PublisherService(platformRouter, mockZernioPublisher, postRepo);

    mockAnalyticsProvider = {
      getPostAnalytics: jest.fn(),
      getPostTimeline: jest.fn(),
      getOverview: jest.fn(),
    };

    analyticsService = new AnalyticsService(mockAnalyticsProvider, undefined, postRepo);
  });

  afterAll(async () => {
    await closePool();
  });

  test('1. creating a post record and storing Zernio post ID & platform post ID', async () => {
    const postRecord: PostRecord = {
      internalPostId: 'post_4e5d9b8b-86bb-4502-a874-e0b3cb474b07',
      providerPostId: '6ab40cc2f089802ac774c50b',
      idempotencyKey: 'req_test_mapping_1',
      caption: 'Test persistent mapping',
      publishNow: true,
      status: 'published',
      platforms: [
        {
          platform: 'facebook',
          status: 'published',
          platformPostId: 'fb_999888',
          platformPostUrl: 'https://facebook.com/fb_999888',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await postRepo.save(postRecord);

    const saved = await postRepo.findById('post_4e5d9b8b-86bb-4502-a874-e0b3cb474b07');
    expect(saved).toBeDefined();
    expect(saved?.internalPostId).toBe('post_4e5d9b8b-86bb-4502-a874-e0b3cb474b07');
    expect(saved?.providerPostId).toBe('6ab40cc2f089802ac774c50b');
    expect(saved?.platforms[0].platformPostId).toBe('fb_999888');
    expect(saved?.platforms[0].platformPostUrl).toBe('https://facebook.com/fb_999888');
  });

  test('2. resolving internal post ID -> Zernio post ID', async () => {
    const postRecord: PostRecord = {
      internalPostId: 'post_local_abc',
      providerPostId: 'zernio_upstream_xyz',
      idempotencyKey: 'req_resolve_1',
      caption: 'Resolve test',
      publishNow: true,
      status: 'published',
      platforms: [
        {
          platform: 'facebook',
          status: 'published',
          platformPostId: 'fb_post_100',
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await postRepo.save(postRecord);

    const resolved = await postRepo.resolveZernioPostId('post_local_abc');
    expect(resolved).toBe('zernio_upstream_xyz');
  });

  test('3. analytics lookup uses resolved Zernio post ID after simulated restart', async () => {
    // Save post mapping to repository
    const postRecord: PostRecord = {
      internalPostId: 'post_restart_123',
      providerPostId: '6ab40cc2f089802ac774c50b',
      idempotencyKey: 'req_restart_123',
      caption: 'Post before restart',
      publishNow: true,
      status: 'published',
      platforms: [{ platform: 'facebook', status: 'published', platformPostId: 'fb_123' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await postRepo.save(postRecord);

    // Simulate backend restart by instantiating fresh AnalyticsService with new PostRepository instance (or cleared cache)
    const freshPostRepo = new PostRepositoryService();
    // Copy/share state or fetch from DB
    await freshPostRepo.save(postRecord); // persists in repository

    const freshAnalyticsService = new AnalyticsService(mockAnalyticsProvider, undefined, freshPostRepo);

    mockAnalyticsProvider.getPostAnalytics.mockResolvedValueOnce({
      postId: '6ab40cc2f089802ac774c50b',
      platform: 'facebook',
      metrics: {
        impressions: 2500,
        reach: 2000,
        likes: 150,
        comments: 25,
        shares: 10,
        saves: 5,
        clicks: 40,
        views: 0,
        engagementRate: 11.25,
      },
      reactionBreakdown: null,
      timeline: [],
      fetchedAt: new Date().toISOString(),
    });

    const result = await freshAnalyticsService.getPostAnalytics('post_restart_123');

    // Upstream call should be invoked with resolved Zernio post ID: '6ab40cc2f089802ac774c50b'
    expect(mockAnalyticsProvider.getPostAnalytics).toHaveBeenCalledWith('6ab40cc2f089802ac774c50b');
    expect(result.postId).toBe('post_restart_123');
    expect(result.metrics.impressions).toBe(2500);
  });

  test('4. timeline lookup resolves internal post ID -> Zernio post ID', async () => {
    const postRecord: PostRecord = {
      internalPostId: 'post_tl_001',
      providerPostId: 'zernio_tl_999',
      idempotencyKey: 'req_tl_1',
      caption: 'Timeline test',
      publishNow: true,
      status: 'published',
      platforms: [{ platform: 'facebook', status: 'published' }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await postRepo.save(postRecord);

    mockAnalyticsProvider.getPostTimeline.mockResolvedValueOnce([
      {
        date: '2026-10-01',
        impressions: 1000,
        reach: 800,
        likes: 50,
        comments: 5,
        shares: 2,
        saves: 0,
        clicks: 10,
        views: 0,
        engagementRate: 8.38,
      },
    ]);

    const result = await analyticsService.getPostTimeline('post_tl_001');

    expect(mockAnalyticsProvider.getPostTimeline).toHaveBeenCalledWith('zernio_tl_999');
    expect(result.postId).toBe('post_tl_001');
    expect(result.timeline.length).toBe(1);
  });

  test('5. failed publish does not create false published state', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: false,
      postId: 'post_failed_123',
      status: 'failed',
      platforms: [{ platform: 'facebook', status: 'failed', error: 'API Auth Error' }],
      error: 'API Auth Error',
    });

    const result = await publisherService.publishPost({
      caption: 'Failing publish test',
      platforms: [{ platform: 'facebook', accountId: 'acc_1' }],
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');

    const saved = await postRepo.findById(result.postId);
    expect(saved).toBeUndefined();
  });

  test('6. duplicate/idempotent publish does not create duplicate records', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: true,
      postId: 'zernio_idempotency_post_777',
      status: 'published',
      platforms: [{ platform: 'facebook', status: 'published', platformPostId: 'fb_777' }],
    });

    const publishInput = {
      caption: 'Idempotency test post',
      platforms: [{ platform: 'facebook', accountId: 'acc_1' }],
      idempotencyKey: 'custom_idempotency_key_777',
    };

    const firstRes = await publisherService.publishPost(publishInput);
    const secondRes = await publisherService.publishPost(publishInput);

    expect(firstRes.status).toBe('published');
    expect(secondRes.status).toBe('published');
    expect(secondRes.postId).toBe(firstRes.postId);

    // Zernio publisher should only be called ONCE
    expect(mockZernioPublisher.publish).toHaveBeenCalledTimes(1);

    const allPosts = await postRepo.listAll();
    expect(allPosts.length).toBe(1);
  });
});
