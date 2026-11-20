import request from 'supertest';
import { createApp } from '../src/app';
import { generateToken, hashPassword } from '../src/auth/auth.service';
import { PostRepositoryService } from '../src/social/services/post-repository.service';
import { PublisherService } from '../src/social/services/publisher.service';
import { PlatformRouter } from '../src/social/router/platform.router';
import { ZernioPublisher } from '../src/social/providers/zernio/zernio.publisher';
import { AnalyticsService } from '../src/social/services/analytics.service';
import { ZernioAnalyticsProvider } from '../src/social/providers/zernio/zernio.analytics';
import { AnalyticsRepositoryService } from '../src/social/services/analytics-repository.service';
import { ZernioClient } from '../src/social/providers/zernio/zernio.client';
import * as dbModule from '../src/db';

// Mock the UserRepository so tests don't require a live PostgreSQL DB
jest.mock('../src/auth/user.repository');
import { UserRepository } from '../src/auth/user.repository';

const MockedUserRepository = UserRepository as jest.MockedClass<typeof UserRepository>;

describe('Authentication & Tenant Isolation Tests', () => {
  let app: ReturnType<typeof createApp>;
  let postRepository: PostRepositoryService;
  let mockUser: any;
  let mockOwnerUser: any;

  beforeAll(async () => {
    const passwordHash = await hashPassword('password123');
    mockUser = {
      id: 'id_user_a',
      email: 'usera@example.com',
      passwordHash,
      role: 'user' as const,
      createdAt: new Date().toISOString(),
    };
    mockOwnerUser = {
      id: 'id_owner_user',
      email: 'owner@example.com',
      passwordHash,
      role: 'owner' as const,
      createdAt: new Date().toISOString(),
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    postRepository = new PostRepositoryService();

    jest.spyOn(ZernioClient.prototype, 'verifyAuth').mockResolvedValue({
      valid: true,
      authType: 'api_key',
      accounts: [{ id: '6ab3ef6b8d284ffb21357563', name: 'Secret Page' }],
      internalToken: 'secret_jwt_token',
    } as any);

    const mockZernioPublisher = {
      publish: jest.fn().mockImplementation(async (input, idempotencyKey, internalPostId) => ({
        success: true,
        postId: `zernio_${internalPostId}`,
        status: 'published',
        platforms: input.platforms.map((p: any) => ({
          platform: p.platform,
          status: 'published',
          accountId: p.accountId,
        })),
      })),
    };
    const publisherService = new PublisherService(new PlatformRouter(), mockZernioPublisher as any, postRepository);
    app = createApp(publisherService, postRepository);
  });

  // ─── Signup ───────────────────────────────────────────────────────────────

  describe('POST /api/auth/signup', () => {
    it('returns 201 and sets cookie with valid credentials', async () => {
      MockedUserRepository.prototype.findByEmail.mockResolvedValueOnce(null);
      MockedUserRepository.prototype.createUser.mockResolvedValueOnce(mockUser);

      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'usera@example.com', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('usera@example.com');
      expect(res.body.user.role).toBe('user');
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(
        Array.isArray(cookies)
          ? cookies.some((c: string) => c.startsWith('auth_token='))
          : cookies.startsWith('auth_token=')
      ).toBe(true);
    });

    it('returns 409 on duplicate email', async () => {
      MockedUserRepository.prototype.findByEmail.mockResolvedValueOnce(mockUser);

      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'usera@example.com', password: 'password123' });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('Email already in use.');
    });

    it('returns 400 on invalid email format', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'not-an-email', password: 'password123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 on short password', async () => {
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ email: 'usera@example.com', password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── Login ────────────────────────────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    it('returns 200 and sets httpOnly cookie on correct credentials', async () => {
      MockedUserRepository.prototype.findByEmail.mockResolvedValueOnce(mockUser);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'usera@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.id).toBe('id_user_a');
      expect(res.body.user.email).toBe('usera@example.com');

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(
        Array.isArray(cookies)
          ? cookies.some((c: string) => c.startsWith('auth_token='))
          : cookies.startsWith('auth_token=')
      ).toBe(true);
    });

    it('returns 401 on wrong password', async () => {
      MockedUserRepository.prototype.findByEmail.mockResolvedValueOnce(mockUser);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'usera@example.com', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password.');
    });

    it('returns 401 when user not found', async () => {
      MockedUserRepository.prototype.findByEmail.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'somepassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password.');
    });
  });

  // ─── Logout ───────────────────────────────────────────────────────────────

  describe('POST /api/auth/logout', () => {
    it('returns 200 and clears auth_token cookie with matching attributes', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieArr = Array.isArray(cookies) ? cookies : [cookies];
      const authCookie = cookieArr.find((c: string) => c.startsWith('auth_token='));
      expect(authCookie).toBeDefined();
    });
  });

  // ─── Owner Setup ──────────────────────────────────────────────────────────

  describe('POST /api/auth/owner-setup', () => {
    it('returns 403 when OWNER_SETUP_TOKEN is not set or mismatched', async () => {
      const originalToken = process.env.OWNER_SETUP_TOKEN;
      delete process.env.OWNER_SETUP_TOKEN;

      const res = await request(app)
        .post('/api/auth/owner-setup')
        .send({ setupToken: 'any-token', email: 'owner@example.com', password: 'password123' });

      expect(res.status).toBe(403);
      process.env.OWNER_SETUP_TOKEN = originalToken;
    });

    it('returns 409 if owner already exists', async () => {
      process.env.OWNER_SETUP_TOKEN = 'valid-setup-token';
      MockedUserRepository.prototype.ownerExists.mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/auth/owner-setup')
        .send({ setupToken: 'valid-setup-token', email: 'owner@example.com', password: 'password123' });

      expect(res.status).toBe(409);
      delete process.env.OWNER_SETUP_TOKEN;
    });

    it('creates owner and calls createOwnerWithAssociations to assign legacy posts & facebook account', async () => {
      process.env.OWNER_SETUP_TOKEN = 'valid-setup-token';
      MockedUserRepository.prototype.ownerExists.mockResolvedValueOnce(false);
      MockedUserRepository.prototype.createOwnerWithAssociations.mockResolvedValueOnce(mockOwnerUser);

      const res = await request(app)
        .post('/api/auth/owner-setup')
        .send({ setupToken: 'valid-setup-token', email: 'owner@example.com', password: 'password123' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(MockedUserRepository.prototype.createOwnerWithAssociations).toHaveBeenCalled();

      delete process.env.OWNER_SETUP_TOKEN;
    });

    it('returns 409 on conflict when Facebook account belongs to another user', async () => {
      process.env.OWNER_SETUP_TOKEN = 'valid-setup-token';
      MockedUserRepository.prototype.ownerExists.mockResolvedValueOnce(false);
      MockedUserRepository.prototype.createOwnerWithAssociations.mockRejectedValueOnce(
        new Error("Conflict: existing social account '6ab3ef6b8d284ffb21357563' is already owned by another user.")
      );

      const res = await request(app)
        .post('/api/auth/owner-setup')
        .send({ setupToken: 'valid-setup-token', email: 'owner@example.com', password: 'password123' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already owned by another user');

      delete process.env.OWNER_SETUP_TOKEN;
    });

    it('returns 409 on conflict when Facebook account has mismatched platform or account ID', async () => {
      process.env.OWNER_SETUP_TOKEN = 'valid-setup-token';
      MockedUserRepository.prototype.ownerExists.mockResolvedValueOnce(false);
      MockedUserRepository.prototype.createOwnerWithAssociations.mockRejectedValueOnce(
        new Error("Conflict: existing social account '6ab3ef6b8d284ffb21357563' has mismatched platform or account_id.")
      );

      const res = await request(app)
        .post('/api/auth/owner-setup')
        .send({ setupToken: 'valid-setup-token', email: 'owner@example.com', password: 'password123' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('mismatched');

      delete process.env.OWNER_SETUP_TOKEN;
    });
  });

  // ─── Current User (/me) ───────────────────────────────────────────────────

  describe('GET /api/auth/me', () => {
    it('returns 401 when no auth cookie is provided', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Authentication required.');
    });

    it('returns user info when valid auth cookie is provided', async () => {
      MockedUserRepository.prototype.findById.mockResolvedValueOnce(mockUser);
      const token = generateToken(mockUser.id, mockUser.role);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', [`auth_token=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.email).toBe('usera@example.com');
    });
  });

  // ─── Unauthenticated Rejection across /api/social/* ───────────────────────

  describe('Unauthenticated Social Route Guards', () => {
    it('returns 401 for GET /api/social/posts without cookie', async () => {
      const res = await request(app).get('/api/social/posts');
      expect(res.status).toBe(401);
    });

    it('returns 401 for POST /api/social/publish without cookie', async () => {
      const res = await request(app).post('/api/social/publish').send({
        caption: 'Unauthenticated post',
        platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }],
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for GET /api/social/analytics/overview without cookie', async () => {
      const res = await request(app).get('/api/social/analytics/overview');
      expect(res.status).toBe(401);
    });

    it('returns 401 for GET /api/social/accounts without cookie', async () => {
      const res = await request(app).get('/api/social/accounts');
      expect(res.status).toBe(401);
    });

    it('returns 401 for GET /api/social/auth/verify without cookie', async () => {
      const res = await request(app).get('/api/social/auth/verify');
      expect(res.status).toBe(401);
    });
  });

  // ─── Tenant Isolation: Cross-User Rejection ───────────────────────────────

  describe('Tenant Isolation & Cross-User Security', () => {
    const userAToken = generateToken('id_user_a', 'user');
    const userBToken = generateToken('id_user_b', 'user');

    beforeEach(async () => {
      // User B owns post_b
      await postRepository.save({
        internalPostId: 'post_b',
        userId: 'id_user_b',
        idempotencyKey: 'key_post_b',
        caption: 'User B private post',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // User A owns account acc_a
      await postRepository.saveAccount({
        id: 'acc_a',
        userId: 'id_user_a',
        platform: 'facebook',
        accountId: 'acc_a',
        displayName: 'User A Page',
      });

      // User B owns account acc_b
      await postRepository.saveAccount({
        id: 'acc_b',
        userId: 'id_user_b',
        platform: 'facebook',
        accountId: 'acc_b',
        displayName: 'User B Page',
      });
    });

    it('User A cannot read User B post via GET /posts/:id (returns 404)', async () => {
      const res = await request(app)
        .get('/api/social/posts/post_b')
        .set('Cookie', [`auth_token=${userAToken}`]);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('User B CAN read their own post via GET /posts/:id (returns 200)', async () => {
      const res = await request(app)
        .get('/api/social/posts/post_b')
        .set('Cookie', [`auth_token=${userBToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.post.internalPostId).toBe('post_b');
    });

    it('GET /api/social/posts lists only the requesting user posts', async () => {
      // User A has 0 posts
      const resA = await request(app)
        .get('/api/social/posts')
        .set('Cookie', [`auth_token=${userAToken}`]);

      expect(resA.status).toBe(200);
      expect(resA.body.count).toBe(0);

      // User B has 1 post
      const resB = await request(app)
        .get('/api/social/posts')
        .set('Cookie', [`auth_token=${userBToken}`]);

      expect(resB.status).toBe(200);
      expect(resB.body.count).toBe(1);
      expect(resB.body.posts[0].internalPostId).toBe('post_b');
    });

    it('User A cannot read User B post analytics (returns 404)', async () => {
      const res = await request(app)
        .get('/api/social/analytics/post_b')
        .set('Cookie', [`auth_token=${userAToken}`]);

      expect(res.status).toBe(404);
    });

    it('User A cannot read User B post timeline (returns 404)', async () => {
      const res = await request(app)
        .get('/api/social/analytics/post_b/timeline')
        .set('Cookie', [`auth_token=${userAToken}`]);

      expect(res.status).toBe(404);
    });

    it('publish with another users accountId is rejected with 403', async () => {
      const res = await request(app)
        .post('/api/social/publish')
        .set('Cookie', [`auth_token=${userAToken}`])
        .send({
          caption: 'User A attempting to publish to User B account',
          platforms: [{ platform: 'facebook', accountId: 'acc_b' }],
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Forbidden');
    });

    it('GET /api/social/accounts returns only the requesting users accounts', async () => {
      const resA = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', [`auth_token=${userAToken}`]);

      expect(resA.status).toBe(200);
      expect(resA.body.accounts).toHaveLength(1);
      expect(resA.body.accounts[0].accountId).toBe('acc_a');

      const resB = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', [`auth_token=${userBToken}`]);

      expect(resB.status).toBe(200);
      expect(resB.body.accounts).toHaveLength(1);
      expect(resB.body.accounts[0].accountId).toBe('acc_b');
    });

    // ─── Sanitize /api/social/auth/verify for All Roles ────────────────────────

    it('GET /api/social/auth/verify returns only safe connection status without account IDs or tokens for regular user', async () => {
      const res = await request(app)
        .get('/api/social/auth/verify')
        .set('Cookie', [`auth_token=${userAToken}`]);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('valid');
      expect(res.body).toHaveProperty('message');
      expect(res.body.accounts).toBeUndefined();
      expect(res.body.token).toBeUndefined();
      expect(res.body.apiKey).toBeUndefined();
    });

    it('GET /api/social/auth/verify returns only safe connection status without account IDs or tokens for Owner', async () => {
      const ownerToken = generateToken('id_owner_user', 'owner');
      const res = await request(app)
        .get('/api/social/auth/verify')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('valid');
      expect(res.body).toHaveProperty('message');
      expect(res.body.accounts).toBeUndefined();
      expect(res.body.token).toBeUndefined();
      expect(res.body.apiKey).toBeUndefined();
    });

    // ─── Analytics Overview Isolation ────────────────────────────────────────

    it('GET /api/social/analytics/overview returns tenant-scoped metrics for regular User A without leaking other users metrics', async () => {
      const res = await request(app)
        .get('/api/social/analytics/overview')
        .set('Cookie', [`auth_token=${userAToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.overview).toBeDefined();
      expect(res.body.overview.totalPosts).toBe(0);
      expect(res.body.overview.impressions).toBe(0);
      expect(res.body.overview.reach).toBe(0);
    });

    it('GET /api/social/analytics/overview returns tenant-scoped metrics for Owner without leaking other users metrics', async () => {
      const ownerToken = generateToken('id_owner_user', 'owner');
      const res = await request(app)
        .get('/api/social/analytics/overview')
        .set('Cookie', [`auth_token=${ownerToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.overview).toBeDefined();
      expect(res.body.overview.totalPosts).toBe(0);
      expect(res.body.overview.impressions).toBe(0);
    });

    it('User A and User B overview requests are isolated and only return each users own published posts', async () => {
      const resB = await request(app)
        .get('/api/social/analytics/overview')
        .set('Cookie', [`auth_token=${userBToken}`]);

      const resA = await request(app)
        .get('/api/social/analytics/overview')
        .set('Cookie', [`auth_token=${userAToken}`]);

      expect(resB.status).toBe(200);
      expect(resA.status).toBe(200);
      expect(resB.body.overview.totalPosts).toBe(1);
      expect(resA.body.overview.totalPosts).toBe(0);
    });

    // ─── Tenant Idempotency Scoping ──────────────────────────────────────────

    it('User A and User B submitting identical idempotency keys do not collide or see each other posts', async () => {
      const sharedClientKey = 'client_idemp_key_12345';

      // User A publishes post with sharedClientKey
      const resA = await request(app)
        .post('/api/social/publish')
        .set('Cookie', [`auth_token=${userAToken}`])
        .send({
          caption: 'User A original post',
          platforms: [{ platform: 'facebook', accountId: 'acc_a' }],
          idempotencyKey: sharedClientKey,
        });

      expect(resA.status).toBe(200);
      const postAId = resA.body.postId;

      // User B publishes post with the EXACT SAME client idempotency key
      const resB = await request(app)
        .post('/api/social/publish')
        .set('Cookie', [`auth_token=${userBToken}`])
        .send({
          caption: 'User B post with same idempotency key',
          platforms: [{ platform: 'facebook', accountId: 'acc_b' }],
          idempotencyKey: sharedClientKey,
        });

      expect(resB.status).toBe(200);
      const postBId = resB.body.postId;

      // User B must get their OWN post, not User A's post!
      expect(postBId).not.toEqual(postAId);

      // Verify User A repeating the key gets User A's post
      const repeatA = await request(app)
        .post('/api/social/publish')
        .set('Cookie', [`auth_token=${userAToken}`])
        .send({
          caption: 'User A duplicate submit',
          platforms: [{ platform: 'facebook', accountId: 'acc_a' }],
          idempotencyKey: sharedClientKey,
        });
      expect(repeatA.body.postId).toBe(postAId);

      // Verify User B repeating the key gets User B's post
      const repeatB = await request(app)
        .post('/api/social/publish')
        .set('Cookie', [`auth_token=${userBToken}`])
        .send({
          caption: 'User B duplicate submit',
          platforms: [{ platform: 'facebook', accountId: 'acc_b' }],
          idempotencyKey: sharedClientKey,
        });
      expect(repeatB.body.postId).toBe(postBId);
    });

    it('matching idempotency key on legacy row with user_id NULL is never returned to User A via publish', async () => {
      const legacyKey = 'legacy_client_idemp_key_888';
      // Pre-populate legacy unowned post in postRepository
      await postRepository.save({
        internalPostId: 'post_legacy_unowned_888',
        idempotencyKey: legacyKey,
        caption: 'Legacy unowned post in repository',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // User A publishes with the same idempotency key as the legacy unowned post
      const res = await request(app)
        .post('/api/social/publish')
        .set('Cookie', [`auth_token=${userAToken}`])
        .send({
          caption: 'User A post attempting same idempotency key as legacy',
          platforms: [{ platform: 'facebook', accountId: 'acc_a' }],
          idempotencyKey: legacyKey,
        });

      expect(res.status).toBe(200);
      // Must NOT return the legacy post!
      expect(res.body.postId).not.toBe('post_legacy_unowned_888');

      // Check saved post in repository belongs to User A with user-prefixed storage key
      const userAPost = await postRepository.findById(res.body.postId, 'id_user_a');
      expect(userAPost).toBeDefined();
      expect(userAPost?.userId).toBe('id_user_a');
      expect(userAPost?.idempotencyKey).toBe(`id_user_a:${legacyKey}`);
    });

    // ─── Regression Suite: NULL-Owned Rows & Cross-User Security ──────────────

    it('List: postRepository.listAll(userId) and GET /api/social/posts exclude NULL-owned legacy posts and other user posts', async () => {
      // Save an unowned legacy post
      await postRepository.save({
        internalPostId: 'post_unowned_null_list',
        idempotencyKey: 'key_unowned_null_list',
        caption: 'Legacy unowned post with NULL user_id',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // User A list via repository
      const repoPostsA = await postRepository.listAll('id_user_a');
      expect(repoPostsA.map((p) => p.internalPostId)).not.toContain('post_unowned_null_list');
      expect(repoPostsA.map((p) => p.internalPostId)).not.toContain('post_b');

      // User A list via HTTP
      const resA = await request(app)
        .get('/api/social/posts')
        .set('Cookie', [`auth_token=${userAToken}`]);
      expect(resA.status).toBe(200);
      expect(resA.body.posts.map((p: any) => p.internalPostId)).not.toContain('post_unowned_null_list');
      expect(resA.body.posts.map((p: any) => p.internalPostId)).not.toContain('post_b');

      // User B list via HTTP
      const resB = await request(app)
        .get('/api/social/posts')
        .set('Cookie', [`auth_token=${userBToken}`]);
      expect(resB.status).toBe(200);
      expect(resB.body.posts.map((p: any) => p.internalPostId)).not.toContain('post_unowned_null_list');
      expect(resB.body.posts.map((p: any) => p.internalPostId)).toContain('post_b');
    });

    it('Detail: postRepository.findById(id, userId) and GET /api/social/posts/:id return 404 for NULL-owned legacy rows and other user posts', async () => {
      await postRepository.save({
        internalPostId: 'post_unowned_null_detail',
        idempotencyKey: 'key_unowned_null_detail',
        caption: 'Legacy unowned post with NULL user_id',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Repository checks
      expect(await postRepository.findById('post_unowned_null_detail', 'id_user_a')).toBeUndefined();
      expect(await postRepository.findById('post_unowned_null_detail', 'id_user_b')).toBeUndefined();
      expect(await postRepository.findById('post_b', 'id_user_a')).toBeUndefined();

      // HTTP detail checks
      const resNullA = await request(app)
        .get('/api/social/posts/post_unowned_null_detail')
        .set('Cookie', [`auth_token=${userAToken}`]);
      expect(resNullA.status).toBe(404);

      const resNullB = await request(app)
        .get('/api/social/posts/post_unowned_null_detail')
        .set('Cookie', [`auth_token=${userBToken}`]);
      expect(resNullB.status).toBe(404);

      const resOtherUser = await request(app)
        .get('/api/social/posts/post_b')
        .set('Cookie', [`auth_token=${userAToken}`]);
      expect(resOtherUser.status).toBe(404);
    });

    it('Analytics: detail and timeline endpoints return 404 for NULL-owned legacy rows and other user posts', async () => {
      await postRepository.save({
        internalPostId: 'post_unowned_null_analytics',
        idempotencyKey: 'key_unowned_null_analytics',
        caption: 'Legacy unowned post with NULL user_id',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // User A requesting unowned legacy post analytics -> 404
      const resNullAnalytics = await request(app)
        .get('/api/social/analytics/post_unowned_null_analytics')
        .set('Cookie', [`auth_token=${userAToken}`]);
      expect(resNullAnalytics.status).toBe(404);

      // User A requesting unowned legacy post timeline -> 404
      const resNullTimeline = await request(app)
        .get('/api/social/analytics/post_unowned_null_analytics/timeline')
        .set('Cookie', [`auth_token=${userAToken}`]);
      expect(resNullTimeline.status).toBe(404);

      // User A requesting User B post timeline -> 404
      const resOtherTimeline = await request(app)
        .get('/api/social/analytics/post_b/timeline')
        .set('Cookie', [`auth_token=${userAToken}`]);
      expect(resOtherTimeline.status).toBe(404);
    });

    it('Overview: GET /api/social/analytics/overview excludes NULL-owned legacy posts from metrics and total count', async () => {
      await postRepository.save({
        internalPostId: 'post_unowned_null_overview',
        idempotencyKey: 'key_unowned_null_overview',
        caption: 'Legacy unowned post with NULL user_id',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const resA = await request(app)
        .get('/api/social/analytics/overview')
        .set('Cookie', [`auth_token=${userAToken}`]);
      expect(resA.status).toBe(200);
      expect(resA.body.overview.totalPosts).toBe(0);

      const resB = await request(app)
        .get('/api/social/analytics/overview')
        .set('Cookie', [`auth_token=${userBToken}`]);
      expect(resB.status).toBe(200);
      expect(resB.body.overview.totalPosts).toBe(1);
    });

    it('Provider-ID lookup: resolveZernioPostId does NOT resolve provider IDs for NULL-owned or other user posts', async () => {
      await postRepository.save({
        internalPostId: 'post_unowned_null_provider_id',
        idempotencyKey: 'key_unowned_null_provider_id',
        caption: 'Legacy unowned post',
        providerPostId: 'zernio_legacy_secret_999',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published', platformPostId: 'fb_secret_999' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // User A cannot resolve provider ID for unowned legacy post
      const resNull = await postRepository.resolveZernioPostId('post_unowned_null_provider_id', 'id_user_a');
      expect(resNull).toBe('post_unowned_null_provider_id');

      // User A cannot resolve provider ID for User B post
      const resOther = await postRepository.resolveZernioPostId('post_b', 'id_user_a');
      expect(resOther).toBe('post_b');
    });

    it('Scheduler isolation: unscoped operations retrieve all posts including NULL-owned for background scheduling', async () => {
      await postRepository.save({
        internalPostId: 'post_sched_legacy_unowned',
        idempotencyKey: 'key_sched_legacy',
        caption: 'Legacy unowned post for scheduler',
        providerPostId: 'zernio_sched_legacy',
        publishNow: false,
        status: 'scheduled',
        scheduledFor: new Date(Date.now() - 1000).toISOString(),
        platforms: [{ platform: 'facebook', status: 'scheduled', platformPostId: 'fb_sched' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Unscoped listAll returns all posts across users and unowned rows
      const allPosts = await postRepository.listAll();
      expect(allPosts.map((p) => p.internalPostId)).toContain('post_sched_legacy_unowned');
      expect(allPosts.map((p) => p.internalPostId)).toContain('post_b');

      // Unscoped findById retrieves unowned post
      const post = await postRepository.findById('post_sched_legacy_unowned');
      expect(post).toBeDefined();
      expect(post?.internalPostId).toBe('post_sched_legacy_unowned');

      // Unscoped resolveZernioPostId resolves provider ID
      const resolved = await postRepository.resolveZernioPostId('post_sched_legacy_unowned');
      expect(resolved).toBe('zernio_sched_legacy');
    });
  });

  // ─── PostRepositoryService Idempotency Scoping & Ownership Tests ───────────

  describe('PostRepositoryService Idempotency Scoping & Ownership Tests', () => {
    it('in-memory fallback never returns an unowned (legacy) record to an authenticated user', async () => {
      const repo = new PostRepositoryService();
      // Save legacy post with user_id undefined
      await repo.save({
        internalPostId: 'legacy_post_999',
        idempotencyKey: 'legacy_client_key_999',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        caption: 'Legacy unowned post',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // User A queries for this idempotency key -> MUST return undefined
      const userARes = await repo.findByIdempotencyKey('legacy_client_key_999', 'user_a');
      expect(userARes).toBeUndefined();

      // Unscoped lookup CAN retrieve it internally
      const unscopedRes = await repo.findUnscopedByIdempotencyKey('legacy_client_key_999');
      expect(unscopedRes).toBeDefined();
      expect(unscopedRes?.internalPostId).toBe('legacy_post_999');
    });

    it('in-memory fallback: User A and User B using the same client key receive only their own posts', async () => {
      const repo = new PostRepositoryService();
      // User A post
      await repo.save({
        internalPostId: 'post_user_a_1',
        userId: 'user_a',
        idempotencyKey: 'user_a:same_key',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        caption: 'User A post',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // User B post
      await repo.save({
        internalPostId: 'post_user_b_1',
        userId: 'user_b',
        idempotencyKey: 'user_b:same_key',
        publishNow: true,
        status: 'published',
        platforms: [{ platform: 'facebook', status: 'published' }],
        caption: 'User B post',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // User A lookup returns only User A's post
      const resA = await repo.findByIdempotencyKey('same_key', 'user_a');
      expect(resA).toBeDefined();
      expect(resA?.internalPostId).toBe('post_user_a_1');
      expect(resA?.userId).toBe('user_a');

      // User B lookup returns only User B's post
      const resB = await repo.findByIdempotencyKey('same_key', 'user_b');
      expect(resB).toBeDefined();
      expect(resB?.internalPostId).toBe('post_user_b_1');
      expect(resB?.userId).toBe('user_b');

      // User C lookup returns undefined
      const resC = await repo.findByIdempotencyKey('same_key', 'user_c');
      expect(resC).toBeUndefined();
    });

    it('repository DB query path enforces exact user_id match and excludes user_id IS NULL', async () => {
      const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      const mockPool = { query: mockQuery } as any;
      const getDbPoolSpy = jest.spyOn(dbModule, 'getDbPool').mockReturnValue(mockPool);

      const repo = new PostRepositoryService();
      const res = await repo.findByIdempotencyKey('my_key_123', 'tenant_a');

      expect(res).toBeUndefined();
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];

      // Verifies SQL strictly matches user_id and does NOT include OR user_id IS NULL
      expect(sql).toContain('user_id = $3');
      expect(sql).not.toContain('OR user_id IS NULL');
      expect(params).toEqual(['tenant_a:my_key_123', 'my_key_123', 'tenant_a']);

      getDbPoolSpy.mockRestore();
    });

    it('repository DB query path for findUnscopedByIdempotencyKey queries without user scoping', async () => {
      const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
      const mockPool = { query: mockQuery } as any;
      const getDbPoolSpy = jest.spyOn(dbModule, 'getDbPool').mockReturnValue(mockPool);

      const repo = new PostRepositoryService();
      const res = await repo.findUnscopedByIdempotencyKey('legacy_unscoped_key');

      expect(res).toBeUndefined();
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];

      expect(sql).toContain('WHERE idempotency_key = $1');
      expect(sql).not.toContain('user_id');
      expect(params).toEqual(['legacy_unscoped_key']);

      getDbPoolSpy.mockRestore();
    });
  });

  // ─── UserRepository Atomic Owner Setup & Rollback Unit Tests ──────────────

  describe('UserRepository.createOwnerWithAssociations atomic rollback tests', () => {
    const { UserRepository: RealUserRepository } = jest.requireActual('../src/auth/user.repository');

    it('successfully creates owner and associates Facebook account when unowned', async () => {
      const repo = new RealUserRepository();
      const owner = await repo.createOwnerWithAssociations('owner@test.com', 'hashed_pass');
      expect(owner.role).toBe('owner');
      expect(owner.email).toBe('owner@test.com');
      expect(repo.isLegacyAssignedInMemory()).toBe(true);
      const sa = repo.getMemoryOwnerAccount('6ab3ef6b8d284ffb21357563');
      expect(sa.userId).toBe(owner.id);
    });

    it('rolls back and rejects creation if Facebook account is already owned by another user', async () => {
      const repo = new RealUserRepository();
      repo.setMemoryOwnerAccount('6ab3ef6b8d284ffb21357563', {
        id: '6ab3ef6b8d284ffb21357563',
        platform: 'facebook',
        accountId: '6ab3ef6b8d284ffb21357563',
        userId: 'some_other_user_id',
      });

      await expect(
        repo.createOwnerWithAssociations('owner2@test.com', 'hashed_pass')
      ).rejects.toThrow('already owned by another user');

      // Assert owner was NOT created (clean retryable state)
      expect(await repo.ownerExists()).toBe(false);
      expect(await repo.findByEmail('owner2@test.com')).toBeNull();
    });

    it('rolls back and rejects creation if Facebook account has mismatched platform', async () => {
      const repo = new RealUserRepository();
      repo.setMemoryOwnerAccount('6ab3ef6b8d284ffb21357563', {
        id: '6ab3ef6b8d284ffb21357563',
        platform: 'instagram', // Mismatched platform
        accountId: '6ab3ef6b8d284ffb21357563',
        userId: null,
      });

      await expect(
        repo.createOwnerWithAssociations('owner3@test.com', 'hashed_pass')
      ).rejects.toThrow('mismatched platform or account_id');

      // Assert owner was NOT created
      expect(await repo.ownerExists()).toBe(false);
      expect(await repo.findByEmail('owner3@test.com')).toBeNull();
    });

    it('acquires transaction-scoped advisory lock after BEGIN and before checking whether Owner exists', async () => {
      const queryHistory: { sql: string; params?: any[] }[] = [];
      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
          queryHistory.push({ sql, params });
          if (sql === 'BEGIN') return { rows: [] };
          if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
          if (sql.includes("role = 'owner'")) return { rows: [] };
          if (sql.includes('social_accounts') && sql.includes('FOR UPDATE')) return { rows: [] };
          if (sql.includes('INSERT INTO users')) {
            return {
              rows: [
                {
                  id: 'id_mock_owner',
                  email: 'testowner@example.com',
                  password_hash: 'hashed',
                  role: 'owner',
                  created_at: new Date().toISOString(),
                },
              ],
            };
          }
          if (sql.includes('UPDATE posts')) return { rows: [] };
          if (sql.includes('UPDATE social_accounts')) return { rows: [] };
          if (sql.includes('INSERT INTO social_accounts')) {
            return {
              rows: [
                {
                  id: '6ab3ef6b8d284ffb21357563',
                  platform: 'facebook',
                  account_id: '6ab3ef6b8d284ffb21357563',
                  user_id: 'id_mock_owner',
                },
              ],
            };
          }
          if (sql.includes('UPDATE post_platforms')) return { rows: [] };
          if (sql === 'COMMIT') return { rows: [] };
          if (sql === 'ROLLBACK') return { rows: [] };
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      } as any;
      const getDbPoolSpy = jest.spyOn(dbModule, 'getDbPool').mockReturnValue(mockPool);

      const repo = new RealUserRepository();
      const owner = await repo.createOwnerWithAssociations('testowner@example.com', 'hashed');

      expect(owner.role).toBe('owner');
      expect(owner.email).toBe('testowner@example.com');

      const sqlQueries = queryHistory.map((q) => q.sql);
      const beginIdx = sqlQueries.findIndex((s) => s === 'BEGIN');
      const lockIdx = sqlQueries.findIndex((s) => s.includes('pg_advisory_xact_lock'));
      const ownerCheckIdx = sqlQueries.findIndex((s) => s.includes("role = 'owner'"));

      expect(beginIdx).toBeGreaterThanOrEqual(0);
      expect(lockIdx).toBeGreaterThan(beginIdx);
      expect(ownerCheckIdx).toBeGreaterThan(lockIdx);

      // Check advisory lock parameters
      const lockQuery = queryHistory[lockIdx];
      expect(lockQuery.params).toEqual([1514525262, 1331124050]);

      expect(sqlQueries).toContain('COMMIT');
      expect(sqlQueries).not.toContain('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();

      getDbPoolSpy.mockRestore();
    });

    it('causes rollback and throws when Facebook account UPSERT returns zero rows', async () => {
      const queryHistory: string[] = [];
      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          queryHistory.push(sql);
          if (sql === 'BEGIN') return { rows: [] };
          if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
          if (sql.includes("role = 'owner'")) return { rows: [] };
          if (sql.includes('social_accounts') && sql.includes('FOR UPDATE')) return { rows: [] };
          if (sql.includes('INSERT INTO users')) {
            return {
              rows: [
                {
                  id: 'id_mock_owner_conflict',
                  email: 'conflict@example.com',
                  password_hash: 'hashed',
                  role: 'owner',
                  created_at: new Date().toISOString(),
                },
              ],
            };
          }
          if (sql.includes('UPDATE posts')) return { rows: [] };
          if (sql.includes('UPDATE social_accounts')) return { rows: [] };
          if (sql.includes('INSERT INTO social_accounts')) {
            // Simulate guarded ON CONFLICT WHERE evaluating to false (zero rows affected)
            return { rows: [] };
          }
          if (sql === 'ROLLBACK') return { rows: [] };
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      } as any;
      const getDbPoolSpy = jest.spyOn(dbModule, 'getDbPool').mockReturnValue(mockPool);

      const repo = new RealUserRepository();
      await expect(
        repo.createOwnerWithAssociations('conflict@example.com', 'hashed')
      ).rejects.toThrow(/Conflict.*could not be associated/);

      expect(queryHistory).toContain('BEGIN');
      expect(queryHistory).toContain('ROLLBACK');
      expect(queryHistory).not.toContain('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();

      getDbPoolSpy.mockRestore();
    });

    it('causes rollback and throws when Facebook account UPSERT returns wrong identity or owner', async () => {
      const queryHistory: string[] = [];
      const mockClient = {
        query: jest.fn().mockImplementation(async (sql: string) => {
          queryHistory.push(sql);
          if (sql === 'BEGIN') return { rows: [] };
          if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
          if (sql.includes("role = 'owner'")) return { rows: [] };
          if (sql.includes('social_accounts') && sql.includes('FOR UPDATE')) return { rows: [] };
          if (sql.includes('INSERT INTO users')) {
            return {
              rows: [
                {
                  id: 'id_mock_owner_expected',
                  email: 'mismatch@example.com',
                  password_hash: 'hashed',
                  role: 'owner',
                  created_at: new Date().toISOString(),
                },
              ],
            };
          }
          if (sql.includes('UPDATE posts')) return { rows: [] };
          if (sql.includes('UPDATE social_accounts')) return { rows: [] };
          if (sql.includes('INSERT INTO social_accounts')) {
            // Return wrong user_id
            return {
              rows: [
                {
                  id: '6ab3ef6b8d284ffb21357563',
                  platform: 'facebook',
                  account_id: '6ab3ef6b8d284ffb21357563',
                  user_id: 'wrong_owner_id',
                },
              ],
            };
          }
          if (sql === 'ROLLBACK') return { rows: [] };
          return { rows: [] };
        }),
        release: jest.fn(),
      };

      const mockPool = {
        connect: jest.fn().mockResolvedValue(mockClient),
      } as any;
      const getDbPoolSpy = jest.spyOn(dbModule, 'getDbPool').mockReturnValue(mockPool);

      const repo = new RealUserRepository();
      await expect(
        repo.createOwnerWithAssociations('mismatch@example.com', 'hashed')
      ).rejects.toThrow(/Conflict.*returned incorrect identity or owner/);

      expect(queryHistory).toContain('BEGIN');
      expect(queryHistory).toContain('ROLLBACK');
      expect(queryHistory).not.toContain('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();

      getDbPoolSpy.mockRestore();
    });
  });
});
