import { PublisherService } from '../src/social/services/publisher.service';
import { PlatformRouter } from '../src/social/router/platform.router';
import { ZernioPublisher } from '../src/social/providers/zernio/zernio.publisher';
import { PostRepositoryService } from '../src/social/services/post-repository.service';
import { SocialPublishingError } from '../src/social/types/publisher.types';

describe('PublisherService', () => {
  let publisherService: PublisherService;
  let platformRouter: PlatformRouter;
  let mockZernioPublisher: jest.Mocked<ZernioPublisher>;
  let postRepository: PostRepositoryService;

  beforeEach(() => {
    platformRouter = new PlatformRouter();
    postRepository = new PostRepositoryService();
    mockZernioPublisher = {
      publish: jest.fn(),
    } as any;

    publisherService = new PublisherService(platformRouter, mockZernioPublisher, postRepository);
  });

  test('Test Case 3: Missing caption for text post', async () => {
    await expect(
      publisherService.publishPost({
        platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
      })
    ).rejects.toThrow('Caption is required for text posts.');
  });

  test('Test Case 4: Invalid image URL', async () => {
    await expect(
      publisherService.publishPost({
        caption: 'Hello',
        imageUrl: 'not-a-valid-url',
        platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
      })
    ).rejects.toThrow('Invalid imageUrl format. Must be a valid URL string.');
  });

  test('Test Case 5: Unsupported platform', async () => {
    await expect(
      publisherService.publishPost({
        caption: 'Hello',
        platforms: [{ platform: 'unsupported_social', accountId: '123' }],
      })
    ).rejects.toThrow("Platform 'unsupported_social' is not supported.");
  });

  test('Test Case 11: Successful publish', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: true,
      postId: 'zernio_fb_101',
      status: 'published',
      platforms: [
        {
          platform: 'facebook',
          status: 'published',
          platformPostId: 'fb_post_888',
          platformPostUrl: 'https://facebook.com/fb_post_888',
        },
      ],
    });

    const result = await publisherService.publishPost({
      caption: 'Successful marketing post',
      imageUrl: 'https://example.com/photo.png',
      platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('published');
    expect(result.platforms[0].platformPostId).toBe('fb_post_888');

    // Check saved post in tracking repository
    const saved = await postRepository.findByIdempotencyKey(mockZernioPublisher.publish.mock.calls[0][1]);
    expect(saved).toBeDefined();
    expect(saved?.caption).toBe('Successful marketing post');
  });

  test('Test Case 12: Partial platform failure', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: true,
      postId: 'zernio_multi_102',
      status: 'partial',
      platforms: [
        { platform: 'facebook', status: 'published', platformPostId: 'fb_11' },
        { platform: 'linkedin', status: 'failed', error: 'LinkedIn token expired' },
      ],
    });

    const result = await publisherService.publishPost({
      caption: 'Multi-platform post',
      platforms: [
        { platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' },
        { platform: 'linkedin', accountId: 'li_acc_1' },
      ],
    });

    expect(result.status).toBe('partial');
    expect(result.platforms).toHaveLength(2);
    expect(result.platforms.find((p) => p.platform === 'linkedin')?.status).toBe('failed');
  });

  test('Test Case 13: Scheduled post', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: true,
      postId: 'zernio_sched_103',
      status: 'scheduled',
      platforms: [{ platform: 'facebook', status: 'scheduled' }],
    });

    const result = await publisherService.publishPost({
      caption: 'Scheduled marketing post',
      scheduledFor: '2026-10-01T10:00:00',
      timezone: 'Asia/Dhaka',
      platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('scheduled');
  });

  test('Test Case 14: Idempotency deduplication', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: true,
      postId: 'zernio_idempotent_104',
      status: 'published',
      platforms: [{ platform: 'facebook', status: 'published' }],
    });

    const input = {
      caption: 'Idempotent post test',
      platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
      idempotencyKey: 'custom_idempotency_123',
    };

    const firstCall = await publisherService.publishPost(input);
    const secondCall = await publisherService.publishPost(input);

    expect(firstCall.status).toBe('published');
    expect(secondCall.status).toBe('published');

    // Zernio publisher should only be called once because second call is deduplicated from repository
    expect(mockZernioPublisher.publish).toHaveBeenCalledTimes(1);
  });

  test('Test Case 15: Scheduled post with scheduledAt, publishNow false, and empty imageUrl string', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: true,
      postId: 'zernio_sched_105',
      status: 'scheduled',
      platforms: [{ platform: 'facebook', status: 'scheduled' }],
    });

    const result = await publisherService.publishPost({
      caption: 'automatic post done',
      imageUrl: '',
      platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
      publishNow: false,
      scheduledAt: '2026-11-17T22:13',
      timezone: 'Asia/Dhaka',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('scheduled');
    expect(result.platforms[0].status).toBe('scheduled');

    const saved = await postRepository.findById(result.postId);
    expect(saved).toBeDefined();
    expect(saved?.status).toBe('scheduled');
    expect(saved?.scheduledFor).toBe('2026-11-17T22:13');
  });

  test('Test Case 16: ZernioPublisher normalization maps Zernio pending platform status to scheduled', async () => {
    const mockZernioClient = {
      createPost: jest.fn().mockResolvedValueOnce({
        post: {
          _id: 'zernio_post_pending_test',
          status: 'scheduled',
          platforms: [
            {
              platform: 'facebook',
              status: 'pending',
              accountId: '6ab3ef6b8d284ffb21357563',
            },
          ],
        },
        message: 'Post scheduled successfully',
      }),
    } as any;

    const realPublisher = new ZernioPublisher(mockZernioClient, platformRouter);
    const pubResult = await realPublisher.publish(
      {
        caption: 'automatic post done',
        platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
        publishNow: false,
        scheduledFor: '2026-11-17T22:13',
      },
      'req_test_pending_1',
      'internal_p_1'
    );

    expect(pubResult.success).toBe(true);
    expect(pubResult.status).toBe('scheduled');
    expect(pubResult.platforms[0].status).toBe('scheduled');
  });
});
