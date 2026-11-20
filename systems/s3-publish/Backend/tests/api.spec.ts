import request from 'supertest';
import { createApp } from '../src/app';
import { PublisherService } from '../src/social/services/publisher.service';
import { PostRepositoryService } from '../src/social/services/post-repository.service';
import { PlatformRouter } from '../src/social/router/platform.router';
import { ZernioPublisher } from '../src/social/providers/zernio/zernio.publisher';

describe('POST /api/social/publish API Endpoint', () => {
  let app: any;
  let mockZernioPublisher: jest.Mocked<ZernioPublisher>;

  beforeEach(async () => {
    const platformRouter = new PlatformRouter();
    const postRepository = new PostRepositoryService();
    await postRepository.saveAccount({
      id: '6ab3ef6b8d284ffb21357563',
      userId: 'test-user',
      platform: 'facebook',
      accountId: '6ab3ef6b8d284ffb21357563',
      displayName: 'Facebook Page',
    });
    mockZernioPublisher = {
      publish: jest.fn(),
    } as any;

    const publisherService = new PublisherService(platformRouter, mockZernioPublisher, postRepository);
    app = createApp(publisherService, postRepository, undefined, { userId: 'test-user', role: 'owner' });
  });

  test('POST /api/social/publish with valid Facebook payload returns 200', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: true,
      postId: 'zernio_api_test_1',
      status: 'published',
      platforms: [
        {
          platform: 'facebook',
          status: 'published',
          platformPostId: 'fb_post_123',
          platformPostUrl: 'https://facebook.com/fb_post_123',
        },
      ],
    });

    const res = await request(app)
      .post('/api/social/publish')
      .send({
        caption: 'Social Publishing Agent integration test',
        imageUrl: 'https://picsum.photos/800/600',
        platforms: [
          {
            platform: 'facebook',
            accountId: '6ab3ef6b8d284ffb21357563',
          },
        ],
        publishNow: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('published');
    expect(res.body.platforms[0].platform).toBe('facebook');
    expect(res.body.platforms[0].platformPostId).toBe('fb_post_123');
  });

  test('POST /api/social/publish with missing platforms array returns 400', async () => {
    const res = await request(app).post('/api/social/publish').send({
      caption: 'No platforms specified',
      platforms: [],
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Validation error');
  });

  test('GET /api/social/posts retrieves post tracking log', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: true,
      postId: 'zernio_api_test_2',
      status: 'published',
      platforms: [{ platform: 'facebook', status: 'published' }],
    });

    await request(app)
      .post('/api/social/publish')
      .send({
        caption: 'Tracked Post Test',
        platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
      });

    const res = await request(app).get('/api/social/posts');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
    expect(res.body.posts[0].caption).toBe('Tracked Post Test');
  });

  test('POST /api/social/publish schedules post with scheduledAt, publishNow false, and empty imageUrl', async () => {
    mockZernioPublisher.publish.mockResolvedValueOnce({
      success: true,
      postId: 'zernio_sched_api_1',
      status: 'scheduled',
      platforms: [{ platform: 'facebook', status: 'scheduled' }],
    });

    const res = await request(app)
      .post('/api/social/publish')
      .send({
        caption: 'automatic post done',
        imageUrl: '',
        platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
        publishNow: false,
        scheduledAt: '2026-11-17T22:13',
        timezone: 'Asia/Dhaka',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.platforms[0].platform).toBe('facebook');
    expect(res.body.platforms[0].status).toBe('scheduled');

    // Ensure mock was called with normalized fields
    expect(mockZernioPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        caption: 'automatic post done',
        scheduledFor: '2026-11-17T22:13',
        publishNow: false,
      }),
      expect.any(String),
      expect.any(String)
    );
  });
});
