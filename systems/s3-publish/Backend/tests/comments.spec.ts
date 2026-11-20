import request from 'supertest';
import { createApp } from '../src/app';
import { PostRepositoryService } from '../src/social/services/post-repository.service';
import { CommentService } from '../src/social/services/comment.service';
import { generateToken } from '../src/auth/auth.service';
import { SocialPublishingError } from '../src/social/types/publisher.types';

describe('Facebook Comments API - Phase 1 (On-demand & Read-only)', () => {
  const OWNER_USER_ID = 'owner_uuid_123';
  const OTHER_USER_ID = 'other_uuid_456';
  const OWNER_FB_ACCOUNT_ID = '6ab3ef6b8d284ffb21357563';
  const OTHER_FB_ACCOUNT_ID = 'other_fb_acc_99999999';

  let postRepository: PostRepositoryService;
  let mockZernioClient: any;
  let commentService: CommentService;
  let app: any;

  let ownerToken: string;
  let otherToken: string;

  beforeEach(async () => {
    postRepository = new PostRepositoryService();

    // 1. Seed accounts
    await postRepository.saveAccount({
      id: OWNER_FB_ACCOUNT_ID,
      platform: 'facebook',
      accountId: OWNER_FB_ACCOUNT_ID,
      displayName: 'Owner Facebook Page',
      userId: OWNER_USER_ID,
    });

    await postRepository.saveAccount({
      id: OTHER_FB_ACCOUNT_ID,
      platform: 'facebook',
      accountId: OTHER_FB_ACCOUNT_ID,
      displayName: 'Other User Page',
      userId: OTHER_USER_ID,
    });

    // 2. Seed posts
    // Post 1: Owner's Facebook Post (with providerPostId and Facebook platform)
    await postRepository.save({
      internalPostId: 'post_owner_fb_1',
      idempotencyKey: 'idemp_owner_1',
      caption: 'Owner Facebook Post Caption',
      status: 'published',
      userId: OWNER_USER_ID,
      providerPostId: '6afc8a7b988b7ba8ba61efe4',
      publishNow: true,
      createdAt: new Date('2026-11-01').toISOString(),
      updatedAt: new Date('2026-11-01').toISOString(),
      platforms: [
        {
          platform: 'facebook',
          status: 'published',
          accountId: OWNER_FB_ACCOUNT_ID,
          platformPostId: 'fb_post_111',
        },
      ],
    });

    // Post 2: Owner's LinkedIn-only Post (no Facebook platform)
    await postRepository.save({
      internalPostId: 'post_owner_linkedin_only',
      idempotencyKey: 'idemp_owner_li',
      caption: 'Owner LinkedIn Post',
      status: 'published',
      userId: OWNER_USER_ID,
      publishNow: true,
      createdAt: new Date('2026-11-01').toISOString(),
      updatedAt: new Date('2026-11-01').toISOString(),
      platforms: [
        {
          platform: 'linkedin',
          status: 'published',
          accountId: 'li_acc_123',
          platformPostId: 'li_post_111',
        },
      ],
    });

    // Post 3: Other user's Facebook post
    await postRepository.save({
      internalPostId: 'post_other_user_fb',
      idempotencyKey: 'idemp_other_fb',
      caption: 'Other User Facebook Post',
      status: 'published',
      userId: OTHER_USER_ID,
      publishNow: true,
      createdAt: new Date('2026-11-01').toISOString(),
      updatedAt: new Date('2026-11-01').toISOString(),
      platforms: [
        {
          platform: 'facebook',
          status: 'published',
          accountId: OTHER_FB_ACCOUNT_ID,
          platformPostId: 'fb_post_222',
        },
      ],
    });

    // Post 4: Unowned legacy post (userId: null)
    (postRepository as any).posts.set('post_legacy_unowned', {
      internalPostId: 'post_legacy_unowned',
      idempotencyKey: 'idemp_unowned',
      caption: 'Unowned Legacy Post',
      status: 'published',
      userId: null,
      publishNow: true,
      createdAt: new Date('2026-01-01').toISOString(),
      updatedAt: new Date('2026-01-01').toISOString(),
      platforms: [
        {
          platform: 'facebook',
          status: 'published',
          accountId: OWNER_FB_ACCOUNT_ID,
          platformPostId: 'fb_post_unowned',
        },
      ],
    });

    // 3. Mock Zernio Client
    mockZernioClient = {
      getPostComments: jest.fn(),
      getFacebookPostReactions: jest.fn(),
    };

    commentService = new CommentService(mockZernioClient, postRepository);
    app = createApp(undefined, postRepository, undefined, undefined, undefined, commentService);

    ownerToken = generateToken(OWNER_USER_ID, 'owner');
    otherToken = generateToken(OTHER_USER_ID, 'user');
  });

  describe('Authentication and Ownership Security Isolation', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/social/posts/post_owner_fb_1/comments');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(mockZernioClient.getPostComments).not.toHaveBeenCalled();
    });

    it('rejects access when User B attempts to fetch comments for User A post with 404 (exact ownership check)', async () => {
      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments')
        .set('Cookie', [`auth_token=${otherToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
      expect(mockZernioClient.getPostComments).not.toHaveBeenCalled();
    });

    it('rejects access to unowned legacy posts (userId: null) with 404', async () => {
      const res = await request(app)
        .get('/api/social/posts/post_legacy_unowned/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
      expect(mockZernioClient.getPostComments).not.toHaveBeenCalled();
    });

    it('fails closed with 400 if post does not target Facebook', async () => {
      const res = await request(app)
        .get('/api/social/posts/post_owner_linkedin_only/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Facebook comments are only supported for posts published to Facebook');
      expect(mockZernioClient.getPostComments).not.toHaveBeenCalled();
    });
  });

  describe('Server-Side AccountId Resolution & Security', () => {
    it('resolves matching Facebook accountId server-side from owned connection and passes to Zernio', async () => {
      mockZernioClient.getPostComments.mockResolvedValueOnce({
        comments: [
          {
            id: 'c_1',
            comment: 'Great post!',
            from: { name: 'Alice Smith', id: 'fb_user_alice_secret_id' },
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify that Zernio was called with server-resolved accountId and zernioPostId
      expect(mockZernioClient.getPostComments).toHaveBeenCalledWith(
        '6afc8a7b988b7ba8ba61efe4',
        OWNER_FB_ACCOUNT_ID,
        undefined,
        25
      );
    });

    it('fails closed with 400 if account is not owned by the requesting user', async () => {
      // Modify post to reference an account not owned by owner
      const p = await postRepository.findById('post_owner_fb_1', OWNER_USER_ID);
      p!.platforms[0].accountId = 'foreign_unowned_account_id';
      // Also remove user's accounts so fallback cannot match
      (postRepository as any).accounts.clear();

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Could not securely match a connected Facebook account');
      expect(mockZernioClient.getPostComments).not.toHaveBeenCalled();
    });
  });

  describe('Identifier Selection & Missing Identifier Handling', () => {
    it('uses post.providerPostId (Zernio post ID) when available', async () => {
      mockZernioClient.getPostComments.mockResolvedValueOnce({
        comments: [],
        pagination: { hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(mockZernioClient.getPostComments).toHaveBeenCalledWith(
        '6afc8a7b988b7ba8ba61efe4',
        OWNER_FB_ACCOUNT_ID,
        undefined,
        25
      );
    });

    it('uses fbPlatform.platformPostId (Facebook native post ID) when providerPostId is missing', async () => {
      await postRepository.save({
        internalPostId: 'post_owner_fb_native_only',
        idempotencyKey: 'idemp_owner_native',
        caption: 'Post with native Facebook ID only',
        status: 'published',
        userId: OWNER_USER_ID,
        publishNow: true,
        createdAt: new Date('2026-11-01').toISOString(),
        updatedAt: new Date('2026-11-01').toISOString(),
        platforms: [
          {
            platform: 'facebook',
            status: 'published',
            accountId: OWNER_FB_ACCOUNT_ID,
            platformPostId: '1181717618348521_122123709693333427',
          },
        ],
      });

      mockZernioClient.getPostComments.mockResolvedValueOnce({
        comments: [],
        pagination: { hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_native_only/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(mockZernioClient.getPostComments).toHaveBeenCalledWith(
        '1181717618348521_122123709693333427',
        OWNER_FB_ACCOUNT_ID,
        undefined,
        25
      );
    });

    it('fails closed with 400 when no supported post identifier (neither providerPostId nor platformPostId) is present', async () => {
      await postRepository.save({
        internalPostId: 'post_owner_fb_no_ids',
        idempotencyKey: 'idemp_owner_no_ids',
        caption: 'Post without any external IDs',
        status: 'published',
        userId: OWNER_USER_ID,
        publishNow: true,
        createdAt: new Date('2026-11-01').toISOString(),
        updatedAt: new Date('2026-11-01').toISOString(),
        platforms: [
          {
            platform: 'facebook',
            status: 'published',
            accountId: OWNER_FB_ACCOUNT_ID,
            // platformPostId omitted / undefined
          },
        ],
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_no_ids/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('No supported Facebook post identifier found');
      expect(mockZernioClient.getPostComments).not.toHaveBeenCalled();
    });
  });

  describe('404 Fallback to Facebook Native Post ID', () => {
    it('retries with Facebook platformPostId when Zernio providerPostId returns 404', async () => {
      await postRepository.save({
        internalPostId: 'post_owner_fb_404_fallback',
        idempotencyKey: 'idemp_owner_fallback',
        caption: 'Post where Zernio ID 404s',
        status: 'published',
        userId: OWNER_USER_ID,
        providerPostId: '6ac759a05a46bfce97b2f131',
        publishNow: true,
        createdAt: new Date('2026-11-01').toISOString(),
        updatedAt: new Date('2026-11-01').toISOString(),
        platforms: [
          {
            platform: 'facebook',
            status: 'published',
            accountId: OWNER_FB_ACCOUNT_ID,
            platformPostId: '1181717618348521_122118819693333427',
          },
        ],
      });

      // 1st call fails with 404
      mockZernioClient.getPostComments.mockRejectedValueOnce(
        new SocialPublishingError('Post 6ac759a05a46bfce97b2f131 not found', 404)
      );
      // 2nd call (fallback retry) succeeds with comments
      mockZernioClient.getPostComments.mockResolvedValueOnce({
        comments: [
          {
            id: 'c_fallback_1',
            comment: 'Comment retrieved via Facebook native ID',
            from: { name: 'Facebook User' },
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_404_fallback/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.comments).toHaveLength(1);
      expect(res.body.comments[0].text).toBe('Comment retrieved via Facebook native ID');

      // Verify client was called twice with identical accountId, cursor, limit
      expect(mockZernioClient.getPostComments).toHaveBeenCalledTimes(2);
      expect(mockZernioClient.getPostComments).toHaveBeenNthCalledWith(
        1,
        '6ac759a05a46bfce97b2f131',
        OWNER_FB_ACCOUNT_ID,
        undefined,
        25
      );
      expect(mockZernioClient.getPostComments).toHaveBeenNthCalledWith(
        2,
        '1181717618348521_122118819693333427',
        OWNER_FB_ACCOUNT_ID,
        undefined,
        25
      );
    });

    it('does not retry when IDs are identical even if Zernio returns 404', async () => {
      await postRepository.save({
        internalPostId: 'post_owner_fb_same_ids',
        idempotencyKey: 'idemp_owner_same_ids',
        caption: 'Post with identical provider and platform ID',
        status: 'published',
        userId: OWNER_USER_ID,
        providerPostId: 'same_post_id_12345',
        publishNow: true,
        createdAt: new Date('2026-11-01').toISOString(),
        updatedAt: new Date('2026-11-01').toISOString(),
        platforms: [
          {
            platform: 'facebook',
            status: 'published',
            accountId: OWNER_FB_ACCOUNT_ID,
            platformPostId: 'same_post_id_12345',
          },
        ],
      });

      mockZernioClient.getPostComments.mockRejectedValueOnce(
        new SocialPublishingError('Post not found', 404)
      );

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_same_ids/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(404);
      expect(mockZernioClient.getPostComments).toHaveBeenCalledTimes(1);
      expect(mockZernioClient.getPostComments).toHaveBeenCalledWith(
        'same_post_id_12345',
        OWNER_FB_ACCOUNT_ID,
        undefined,
        25
      );
    });

    it('does not retry when no Facebook native ID exists on 404', async () => {
      await postRepository.save({
        internalPostId: 'post_owner_fb_no_native',
        idempotencyKey: 'idemp_owner_no_native',
        caption: 'Post with Zernio ID only',
        status: 'published',
        userId: OWNER_USER_ID,
        providerPostId: 'zernio_only_id_999',
        publishNow: true,
        createdAt: new Date('2026-11-01').toISOString(),
        updatedAt: new Date('2026-11-01').toISOString(),
        platforms: [
          {
            platform: 'facebook',
            status: 'published',
            accountId: OWNER_FB_ACCOUNT_ID,
            // no platformPostId
          },
        ],
      });

      mockZernioClient.getPostComments.mockRejectedValueOnce(
        new SocialPublishingError('Post not found', 404)
      );

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_no_native/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(404);
      expect(mockZernioClient.getPostComments).toHaveBeenCalledTimes(1);
    });

    it('does not retry on non-404 errors (e.g. 401, 403, 429, 500)', async () => {
      await postRepository.save({
        internalPostId: 'post_owner_fb_errors',
        idempotencyKey: 'idemp_owner_errors',
        caption: 'Post to test non-404 errors',
        status: 'published',
        userId: OWNER_USER_ID,
        providerPostId: 'provider_id_err',
        publishNow: true,
        createdAt: new Date('2026-11-01').toISOString(),
        updatedAt: new Date('2026-11-01').toISOString(),
        platforms: [
          {
            platform: 'facebook',
            status: 'published',
            accountId: OWNER_FB_ACCOUNT_ID,
            platformPostId: 'platform_id_err',
          },
        ],
      });

      // Test 429
      mockZernioClient.getPostComments.mockRejectedValueOnce(
        new SocialPublishingError('Rate limit exceeded', 429)
      );

      const res429 = await request(app)
        .get('/api/social/posts/post_owner_fb_errors/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res429.status).toBe(429);
      expect(mockZernioClient.getPostComments).toHaveBeenCalledTimes(1);

      // Test 500
      mockZernioClient.getPostComments.mockClear();
      mockZernioClient.getPostComments.mockRejectedValueOnce(
        new SocialPublishingError('Internal server error', 500)
      );

      const res500 = await request(app)
        .get('/api/social/posts/post_owner_fb_errors/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res500.status).toBe(500);
      expect(mockZernioClient.getPostComments).toHaveBeenCalledTimes(1);
    });
  });

  describe('Comment Normalization, from.id Exclusion & Verified Timestamps', () => {
    it('sets createdAt to null when no verified creation-time field is in Zernio response (never uses fetch time)', async () => {
      const fetchTimeStart = Date.now();

      mockZernioClient.getPostComments.mockResolvedValueOnce({
        comments: [
          {
            id: 'comment_no_time_1',
            comment: 'Comment without time field',
            from: { name: 'Bob John', id: 'bob_id_12345' },
            // Notice: no createdAt, no created_time, no timestamp!
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.comments).toHaveLength(1);

      const comment = res.body.comments[0];
      expect(comment.id).toBe('comment_no_time_1');
      expect(comment.text).toBe('Comment without time field');
      expect(comment.authorName).toBe('Bob John');

      // Crucial verification: createdAt must be NULL, NOT current fetch time!
      expect(comment.createdAt).toBeNull();

      // Crucial security verification: from.id must NOT be exposed!
      expect(comment).not.toHaveProperty('from');
      expect(comment).not.toHaveProperty('fromId');
      expect(comment).not.toHaveProperty('from_id');
      expect(JSON.stringify(comment)).not.toContain('bob_id_12345');
    });

    it('parses valid ISO string when verified creation time is provided by provider', async () => {
      const verifiedTime = '2026-11-19T14:30:00.000Z';

      mockZernioClient.getPostComments.mockResolvedValueOnce({
        comments: [
          {
            id: 'comment_with_time_2',
            text: 'Comment with timestamp',
            createdAt: verifiedTime,
            from: { username: 'charlie_fb', id: 'charlie_secret_id' },
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.comments).toHaveLength(1);

      const comment = res.body.comments[0];
      expect(comment.authorName).toBe('charlie_fb');
      expect(comment.createdAt).toBe(verifiedTime);
      expect(JSON.stringify(comment)).not.toContain('charlie_secret_id');
    });

    it('parses valid createdTime field documented by Zernio into ISO string', async () => {
      const zernioCreatedTime = '2026-11-20T12:00:00.000Z';

      mockZernioClient.getPostComments.mockResolvedValueOnce({
        comments: [
          {
            id: 'comment_zernio_created_time',
            text: 'Comment with documented createdTime',
            createdTime: zernioCreatedTime,
            from: { name: 'Verified Author' },
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.comments[0].createdAt).toBe(zernioCreatedTime);
    });

    it('sets createdAt to null when createdTime is invalid date (never uses fetch time)', async () => {
      mockZernioClient.getPostComments.mockResolvedValueOnce({
        comments: [
          {
            id: 'comment_invalid_time',
            text: 'Comment with malformed createdTime',
            createdTime: 'invalid-non-date-string',
            from: { name: 'Author' },
          },
        ],
        pagination: { hasMore: false, nextCursor: null },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.comments[0].createdAt).toBeNull();
    });
  });

  describe('Pagination & Limits', () => {
    it('supports cursor pagination and forwards limit to provider', async () => {
      mockZernioClient.getPostComments.mockResolvedValueOnce({
        comments: [
          {
            id: 'comment_page_2',
            comment: 'Second page comment',
            from: { name: 'Dave' },
          },
        ],
        pagination: {
          hasMore: true,
          nextCursor: 'next_page_cursor_token_xyz',
        },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments?cursor=cursor_token_abc&limit=10')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(mockZernioClient.getPostComments).toHaveBeenCalledWith(
        '6afc8a7b988b7ba8ba61efe4',
        OWNER_FB_ACCOUNT_ID,
        'cursor_token_abc',
        10
      );
      expect(res.body.pagination.hasMore).toBe(true);
      expect(res.body.pagination.nextCursor).toBe('next_page_cursor_token_xyz');
    });
  });

  describe('Provider Errors and Resilience', () => {
    it('handles Zernio client errors gracefully and returns safe error response', async () => {
      mockZernioClient.getPostComments.mockRejectedValueOnce(
        new SocialPublishingError('Zernio API error 500: Internal server error from provider', 502)
      );

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/comments')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Zernio API error');
    });
  });

  describe('Facebook Post Reactions API', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/social/posts/post_owner_fb_1/reactions');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(mockZernioClient.getFacebookPostReactions).not.toHaveBeenCalled();
    });

    it('rejects access when User B attempts to fetch reactions for User A post with 404 (exact ownership isolation)', async () => {
      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/reactions')
        .set('Cookie', [`auth_token=${otherToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not found');
      expect(mockZernioClient.getFacebookPostReactions).not.toHaveBeenCalled();
    });

    it('rejects access to unowned legacy posts (userId: null) with 404', async () => {
      const res = await request(app)
        .get('/api/social/posts/post_legacy_unowned/reactions')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(mockZernioClient.getFacebookPostReactions).not.toHaveBeenCalled();
    });

    it('fails closed with 400 if post does not target Facebook', async () => {
      const res = await request(app)
        .get('/api/social/posts/post_owner_linkedin_only/reactions')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Facebook post reactions are only supported for posts published to Facebook');
      expect(mockZernioClient.getFacebookPostReactions).not.toHaveBeenCalled();
    });

    it('fetches by Facebook native platformPostId only; never substitutes Zernio provider post ID', async () => {
      mockZernioClient.getFacebookPostReactions.mockResolvedValueOnce({
        total: 15,
        like: 10,
        love: 2,
        haha: 1,
        wow: 1,
        sad: 0,
        angry: 0,
        care: 1,
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/reactions')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.platformPostId).toBe('fb_post_111');

      // Crucial verification: Called with native platformPostId 'fb_post_111', NEVER providerPostId '6afc8a7b988b7ba8ba61efe4'
      expect(mockZernioClient.getFacebookPostReactions).toHaveBeenCalledWith(
        OWNER_FB_ACCOUNT_ID,
        'fb_post_111'
      );
    });

    it('fails closed with 400 if Facebook native post ID is missing', async () => {
      await postRepository.save({
        internalPostId: 'post_owner_fb_missing_native',
        idempotencyKey: 'idemp_owner_missing_native',
        caption: 'Post without native platform post ID',
        status: 'published',
        userId: OWNER_USER_ID,
        providerPostId: '6afc_zernio_id',
        publishNow: true,
        createdAt: new Date('2026-11-01').toISOString(),
        updatedAt: new Date('2026-11-01').toISOString(),
        platforms: [
          {
            platform: 'facebook',
            status: 'published',
            accountId: OWNER_FB_ACCOUNT_ID,
            // platformPostId omitted
          },
        ],
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_missing_native/reactions')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Facebook native post ID (platformPostId) is missing');
      expect(mockZernioClient.getFacebookPostReactions).not.toHaveBeenCalled();
    });

    it('fails closed with 400 if Facebook account is not owned by the requesting user', async () => {
      await postRepository.save({
        internalPostId: 'post_owner_fb_unowned_acc',
        idempotencyKey: 'idemp_owner_unowned_acc',
        caption: 'Post with foreign account ID',
        status: 'published',
        userId: OWNER_USER_ID,
        publishNow: true,
        createdAt: new Date('2026-11-01').toISOString(),
        updatedAt: new Date('2026-11-01').toISOString(),
        platforms: [
          {
            platform: 'facebook',
            status: 'published',
            accountId: OTHER_FB_ACCOUNT_ID,
            platformPostId: 'fb_post_unowned_acc',
          },
        ],
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_unowned_acc/reactions')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Could not securely match a connected Facebook account');
      expect(mockZernioClient.getFacebookPostReactions).not.toHaveBeenCalled();
    });

    it('returns total and all seven reaction counts (like, love, haha, wow, sad, angry, care)', async () => {
      mockZernioClient.getFacebookPostReactions.mockResolvedValueOnce({
        total: 25,
        like: 10,
        love: 5,
        haha: 3,
        wow: 2,
        sad: 1,
        angry: 0,
        care: 4,
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/reactions')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.total).toBe(25);
      expect(res.body.reactions).toEqual({
        like: 10,
        love: 5,
        haha: 3,
        wow: 2,
        sad: 1,
        angry: 0,
        care: 4,
      });
      // Ensure no reactor identities exist
      expect(res.body).not.toHaveProperty('reactors');
      expect(res.body).not.toHaveProperty('users');
    });

    it('parses live Zernio response shape with breakdown object and treats 0 as valid count', async () => {
      mockZernioClient.getFacebookPostReactions.mockResolvedValueOnce({
        total: 2,
        breakdown: {
          like: 2,
          love: 0,
          haha: 0,
          wow: 0,
          sad: 0,
          angry: 0,
          care: 0,
        },
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/reactions')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.total).toBe(2);
      expect(res.body.reactions).toEqual({
        like: 2,
        love: 0,
        haha: 0,
        wow: 0,
        sad: 0,
        angry: 0,
        care: 0,
      });
    });

    it('represents omitted or invalid provider fields as null (unavailable) without inventing counts', async () => {
      mockZernioClient.getFacebookPostReactions.mockResolvedValueOnce({
        total: 'invalid-total',
        like: 7,
        love: 0,
        // haha omitted
        wow: -5, // invalid negative number
        sad: 'not-a-number', // invalid string
        // angry omitted
        care: null, // explicitly null
      });

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/reactions')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.total).toBeNull();
      expect(res.body.reactions).toEqual({
        like: 7,
        love: 0,
        haha: null,
        wow: null,
        sad: null,
        angry: null,
        care: null,
      });
    });

    it('handles provider errors gracefully and returns safe structured error', async () => {
      mockZernioClient.getFacebookPostReactions.mockRejectedValueOnce(
        new SocialPublishingError('Zernio API error 500: Internal server error from provider', 502)
      );

      const res = await request(app)
        .get('/api/social/posts/post_owner_fb_1/reactions')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Zernio API error');
    });
  });
});
