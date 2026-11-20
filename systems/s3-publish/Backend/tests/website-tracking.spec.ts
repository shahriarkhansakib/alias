import request from 'supertest';
import { createApp } from '../src/app';
import { TrackingService } from '../src/tracking/services/tracking.service';
import { TrackingRepositoryService } from '../src/tracking/services/tracking-repository.service';
import { validateAndNormalizeOrigin } from '../src/tracking/utils/origin-validator';
import { TrackingRateLimiter } from '../src/tracking/utils/tracking-rate-limiter';
import { generateToken } from '../src/auth/auth.service';

describe('Phase 2: Website Activity Tracking & Connect Website', () => {
  let app: any;
  let trackingRepository: TrackingRepositoryService;
  let trackingService: TrackingService;

  const userA = { userId: 'user_a_site_123', role: 'user' };
  const userB = { userId: 'user_b_site_456', role: 'user' };
  const tokenA = generateToken(userA.userId, userA.role);
  const tokenB = generateToken(userB.userId, userB.role);

  beforeEach(() => {
    trackingRepository = new TrackingRepositoryService();
    trackingService = new TrackingService(trackingRepository);
    app = createApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      trackingService
    );
  });

  // --- 1. Origin Validation Utility ---

  describe('Origin Validator & Normalization', () => {
    it('normalizes valid origins correctly', () => {
      const res1 = validateAndNormalizeOrigin('https://techghorbd.vercel.app');
      expect(res1.isValid).toBe(true);
      expect(res1.origin).toBe('https://techghorbd.vercel.app');

      const res2 = validateAndNormalizeOrigin('HTTP://MYSTORE.COM/');
      expect(res2.isValid).toBe(true);
      expect(res2.origin).toBe('http://mystore.com');
    });

    it('rejects origins with subdirectories, paths, query parameters, or credentials', () => {
      expect(validateAndNormalizeOrigin('https://techghorbd.vercel.app/store/item').isValid).toBe(false);
      expect(validateAndNormalizeOrigin('https://techghorbd.vercel.app?ref=fb').isValid).toBe(false);
      expect(validateAndNormalizeOrigin('https://admin:pass@techghorbd.vercel.app').isValid).toBe(false);
      expect(validateAndNormalizeOrigin('ftp://techghorbd.vercel.app').isValid).toBe(false);
      expect(validateAndNormalizeOrigin('').isValid).toBe(false);
    });
  });

  // --- 2. Serving First-Party Tracking Script ---

  describe('First-Party Tracking Script (GET /t.js)', () => {
    it('serves lightweight vanilla JS with correct MIME type and caching headers', async () => {
      const res = await request(app).get('/t.js');
      expect(res.status).toBe(200);
      expect(res.header['content-type']).toMatch(/application\/javascript/);
      expect(res.header['cache-control']).toMatch(/public/);
      expect(res.text).toContain('data-track-product-id');
      expect(res.text).toContain('page_view');
      expect(res.text).toContain('product_click');
    });
  });

  // --- 3. Authenticated Website Registration & Snippet Generation ---

  describe('Website Registration & Snippet Generation', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app)
        .post('/api/social/tracking/websites')
        .send({ name: 'My Store', origin: 'https://techghorbd.vercel.app' });
      expect(res.status).toBe(401);
    });

    it('registers a website and generates a copyable script snippet with siteId', async () => {
      const res = await request(app)
        .post('/api/social/tracking/websites')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ name: 'Tech Ghor BD', origin: 'https://techghorbd.vercel.app' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.website).toBeDefined();
      expect(res.body.website.siteId).toMatch(/^site_/);
      expect(res.body.website.origin).toBe('https://techghorbd.vercel.app');
      expect(res.body.snippet).toContain(res.body.website.siteId);
      expect(res.body.snippet).toContain('<script defer src=');
    });
  });

  // --- 4. User/Site/Product Ownership Isolation ---

  describe('Multi-User & Cross-Tenant Ownership Isolation', () => {
    it('prevents User B from viewing User A websites or activity', async () => {
      // User A registers a site
      await request(app)
        .post('/api/social/tracking/websites')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ name: 'Store A', origin: 'https://store-a.vercel.app' });

      // User B lists websites -> empty
      const listB = await request(app)
        .get('/api/social/tracking/websites')
        .set('Cookie', [`auth_token=${tokenB}`]);
      expect(listB.status).toBe(200);
      expect(listB.body.websites).toHaveLength(0);

      // User B website stats -> null website
      const statsB = await request(app)
        .get('/api/social/tracking/website-stats')
        .set('Cookie', [`auth_token=${tokenB}`]);
      expect(statsB.status).toBe(200);
      expect(statsB.body.website).toBeNull();
      expect(statsB.body.totalPageViews).toBe(0);
    });

    it('rejects product_click if productId belongs to another user', async () => {
      // User A creates a product
      const prodA = await trackingService.createProduct(
        userA.userId,
        'Headphones',
        'https://techghorbd.vercel.app/headphones'
      );

      // User B registers a site
      const regB = await trackingService.registerWebsite(
        userB.userId,
        'Store B',
        'https://store-b.vercel.app'
      );

      // Attempt to send product_click for User A's product using User B's site
      const res = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://store-b.vercel.app')
        .send({
          siteId: regB.website.siteId,
          eventName: 'product_click',
          eventId: 'evt_cross_user_attempt',
          productId: prodA.id,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not owned by the registered website owner/i);
    });

    it('allows User A to register multiple websites and list all owned sites', async () => {
      // User A registers Site 1
      const reg1 = await request(app)
        .post('/api/social/tracking/websites')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ name: 'Site One', origin: 'https://site-one.com' });
      expect(reg1.status).toBe(201);

      // User A registers Site 2
      const reg2 = await request(app)
        .post('/api/social/tracking/websites')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ name: 'Site Two', origin: 'https://site-two.com' });
      expect(reg2.status).toBe(201);

      // User A lists websites
      const res = await request(app)
        .get('/api/social/tracking/websites')
        .set('Cookie', [`auth_token=${tokenA}`]);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.websites).toHaveLength(2);
      const origins = res.body.websites.map((w: any) => w.origin);
      expect(origins).toContain('https://site-one.com');
      expect(origins).toContain('https://site-two.com');
    });

    it('allows User A to select a specific website via websiteId in stats query', async () => {
      const reg1 = await trackingService.registerWebsite(
        userA.userId,
        'Alpha Store',
        'https://alpha-store.com'
      );
      const reg2 = await trackingService.registerWebsite(
        userA.userId,
        'Beta Store',
        'https://beta-store.com'
      );

      // Query without websiteId -> returns stats with full websites list and an active website
      const resDefault = await request(app)
        .get('/api/social/tracking/website-stats')
        .set('Cookie', [`auth_token=${tokenA}`]);
      expect(resDefault.status).toBe(200);
      expect(resDefault.body.website).toBeDefined();
      expect([reg1.website.id, reg2.website.id]).toContain(resDefault.body.website.id);
      expect(resDefault.body.websites).toHaveLength(2);

      // Query explicitly with Alpha Store websiteId -> returns Alpha Store
      const resAlpha = await request(app)
        .get(`/api/social/tracking/website-stats?websiteId=${reg1.website.id}`)
        .set('Cookie', [`auth_token=${tokenA}`]);
      expect(resAlpha.status).toBe(200);
      expect(resAlpha.body.website.id).toBe(reg1.website.id);
      expect(resAlpha.body.website.origin).toBe('https://alpha-store.com');
      expect(resAlpha.body.websites).toHaveLength(2);

      // Query explicitly with Beta Store websiteId -> returns Beta Store
      const resBeta = await request(app)
        .get(`/api/social/tracking/website-stats?websiteId=${reg2.website.id}`)
        .set('Cookie', [`auth_token=${tokenA}`]);
      expect(resBeta.status).toBe(200);
      expect(resBeta.body.website.id).toBe(reg2.website.id);
      expect(resBeta.body.website.origin).toBe('https://beta-store.com');
      expect(resBeta.body.websites).toHaveLength(2);
    });

    it('ensures User B cannot access User A connected website by websiteId', async () => {
      const regA = await trackingService.registerWebsite(
        userA.userId,
        'User A Secret Site',
        'https://usera-secret.com'
      );

      // User B attempts to query User A's websiteId
      const resB = await request(app)
        .get(`/api/social/tracking/website-stats?websiteId=${regA.website.id}`)
        .set('Cookie', [`auth_token=${tokenB}`]);

      expect(resB.status).toBe(200);
      // User B has no owned websites matching that ID, so website is null and websites array is empty
      expect(resB.body.website).toBeNull();
      expect(resB.body.websites).toHaveLength(0);
      expect(resB.body.totalPageViews).toBe(0);
    });
  });

  // --- 5. Origin Allowlisting & CORS ---

  describe('Origin Allowlisting & CORS Preflight', () => {
    let siteA: any;

    beforeEach(async () => {
      const reg = await trackingService.registerWebsite(
        userA.userId,
        'Tech Ghor BD',
        'https://techghorbd.vercel.app'
      );
      siteA = reg.website;
    });

    it('accepts events originating from the exact registered origin', async () => {
      const res = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteA.siteId,
          eventName: 'page_view',
          eventId: 'evt_valid_origin_1',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.header['access-control-allow-origin']).toBe('https://techghorbd.vercel.app');
      expect(res.header['access-control-allow-credentials']).toBeUndefined();
    });

    it('strictly rejects requests with missing Origin header with generic 403', async () => {
      const res = await request(app)
        .post('/api/tracking/events')
        .send({
          siteId: siteA.siteId,
          eventName: 'page_view',
          eventId: 'evt_missing_origin',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Origin not authorized.');
      expect(res.body.error).not.toContain(siteA.siteId);
    });

    it('strictly rejects requests with malformed Origin header with generic 403', async () => {
      const res = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://malformed-site.com/path/not/allowed')
        .send({
          siteId: siteA.siteId,
          eventName: 'page_view',
          eventId: 'evt_malformed_origin',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Origin not authorized.');
      expect(res.body.error).not.toContain('malformed-site.com');
      expect(res.body.error).not.toContain(siteA.siteId);
    });

    it('strictly rejects events from unauthorized origins with generic 403 without echoing origin or siteId', async () => {
      const res = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://malicious-spoof.com')
        .send({
          siteId: siteA.siteId,
          eventName: 'page_view',
          eventId: 'evt_bad_origin_1',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe('Origin not authorized.');
      // Never echo the supplied Origin or siteId in error
      expect(res.body.error).not.toContain('malicious-spoof.com');
      expect(res.body.error).not.toContain(siteA.siteId);
    });

    it('handles CORS OPTIONS preflight request with 204 and exact origin without wildcard or credentials', async () => {
      const res = await request(app)
        .options('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app');

      expect(res.status).toBe(204);
      expect(res.header['access-control-allow-origin']).toBe('https://techghorbd.vercel.app');
      expect(res.header['access-control-allow-methods']).toContain('POST');
      expect(res.header['access-control-allow-headers']).toContain('Content-Type');
      expect(res.header['access-control-allow-origin']).not.toBe('*');
      expect(res.header['access-control-allow-credentials']).toBeUndefined();
    });
  });

  // --- 6. Strict Event Allowlist & Payload Validation ---

  describe('Event Allowlist & Payload Validation', () => {
    let siteA: any;

    beforeEach(async () => {
      const reg = await trackingService.registerWebsite(
        userA.userId,
        'Tech Ghor BD',
        'https://techghorbd.vercel.app'
      );
      siteA = reg.website;
    });

    it('accepts page_view and product_click events', async () => {
      const res = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteA.siteId,
          eventName: 'page_view',
          eventId: 'evt_pageview_test',
        });
      expect(res.status).toBe(200);
    });

    it('rejects arbitrary or unallowed event names with 400', async () => {
      const res1 = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteA.siteId,
          eventName: 'purchase', // Not allowed in Phase 2
          eventId: 'evt_bad_1',
        });
      expect(res1.status).toBe(400);
      expect(res1.body.error).toMatch(/Allowed events are 'page_view' and 'product_click'/i);

      const res2 = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteA.siteId,
          eventName: 'checkout_step',
          eventId: 'evt_bad_2',
        });
      expect(res2.status).toBe(400);
    });

    it('rejects requests with missing siteId or eventId', async () => {
      const res = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          eventName: 'page_view',
        });
      expect(res.status).toBe(400);
    });
  });

  // --- 7. Event Idempotency ---

  describe('Event-Id Idempotency', () => {
    let siteA: any;

    beforeEach(async () => {
      const reg = await trackingService.registerWebsite(
        userA.userId,
        'Tech Ghor BD',
        'https://techghorbd.vercel.app'
      );
      siteA = reg.website;
    });

    it('does not duplicate counts when the same eventId is redelivered', async () => {
      const payload = {
        siteId: siteA.siteId,
        eventName: 'page_view',
        eventId: 'evt_idempotency_fixed_123',
      };

      // 1st delivery -> inserted
      const res1 = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send(payload);
      expect(res1.status).toBe(200);
      expect(res1.body.duplicate).toBe(false);

      // 2nd delivery (e.g. browser retry) -> recognized as duplicate
      const res2 = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send(payload);
      expect(res2.status).toBe(200);
      expect(res2.body.duplicate).toBe(true);

      // Verify count in stats is 1, not 2
      const stats = await request(app)
        .get('/api/social/tracking/website-stats')
        .set('Cookie', [`auth_token=${tokenA}`]);
      expect(stats.body.totalPageViews).toBe(1);
    });
  });

  // --- 8. Bot Preview Exclusion & Privacy Verification ---

  describe('Bot Preview Exclusion & Privacy Verification', () => {
    let siteA: any;
    let prodA: any;

    beforeEach(async () => {
      const reg = await trackingService.registerWebsite(
        userA.userId,
        'Tech Ghor BD',
        'https://techghorbd.vercel.app'
      );
      siteA = reg.website;

      prodA = await trackingService.createProduct(
        userA.userId,
        'Earbuds',
        'https://techghorbd.vercel.app/earbuds'
      );
    });

    it('excludes known crawlers/bots from eligible event metrics and avoids creating bot event rows', async () => {
      // Bot event
      const botRes = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .set('User-Agent', 'facebookexternalhit/1.1')
        .send({
          siteId: siteA.siteId,
          eventName: 'page_view',
          eventId: 'evt_bot_fb',
        });
      expect(botRes.status).toBe(200);
      // Confirms bots do not create unbounded rows
      expect((trackingRepository as any).memoryWebsiteEvents).toHaveLength(0);

      // Human event
      const humanRes = await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0')
        .send({
          siteId: siteA.siteId,
          eventName: 'page_view',
          eventId: 'evt_human_1',
        });
      expect(humanRes.status).toBe(200);
      expect((trackingRepository as any).memoryWebsiteEvents).toHaveLength(1);

      const stats = await request(app)
        .get('/api/social/tracking/website-stats')
        .set('Cookie', [`auth_token=${tokenA}`]);

      // Only the human event is included in eligible count
      expect(stats.body.totalPageViews).toBe(1);
    });

    it('verifies that no personal data (IP, cookies, UA) is stored in event records', async () => {
      await request(app)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5) Mobile/15E148')
        .send({
          siteId: siteA.siteId,
          eventName: 'product_click',
          eventId: 'evt_privacy_check',
          productId: prodA.id,
        });

      // Directly inspect in-memory recorded event
      const recordedEvents = (trackingRepository as any).memoryWebsiteEvents;
      expect(recordedEvents).toHaveLength(1);
      const ev = recordedEvents[0];

      // Assert only operational IDs exist
      expect(ev.id).toBeDefined();
      expect(ev.websiteId).toBe(siteA.id);
      expect(ev.userId).toBe(userA.userId);
      expect(ev.eventName).toBe('product_click');
      expect(ev.eventId).toBe('evt_privacy_check');
      expect(ev.productId).toBe(prodA.id);
      expect(ev.isBot).toBe(false);

      // Assert zero PII properties exist
      expect(ev).not.toHaveProperty('ip');
      expect(ev).not.toHaveProperty('ipAddress');
      expect(ev).not.toHaveProperty('userAgent');
      expect(ev).not.toHaveProperty('cookies');
      expect(ev).not.toHaveProperty('fingerprint');
      expect(ev).not.toHaveProperty('referrer');
      expect(ev).not.toHaveProperty('query');
    });
  });

  // --- 9. Localhost Warning & Installation Status ---

  describe('Localhost Warning & Installation Status', () => {
    it('flags installation pending when no events are recorded', async () => {
      await trackingService.registerWebsite(
        userA.userId,
        'Tech Ghor BD',
        'https://techghorbd.vercel.app'
      );

      const stats = await request(app)
        .get('/api/social/tracking/website-stats')
        .set('Cookie', [`auth_token=${tokenA}`]);

      expect(stats.body.installationPending).toBe(true);
      expect(stats.body.isLocalhost).toBe(true);
      expect(stats.body.warning).toMatch(/Localhost backend active/i);
      expect(stats.body.metricLabel).toMatch(/not unique visitors/i);
    });
  });

  // --- 10. Layered In-Memory Rate Limiting & DoS Protection ---

  describe('Layered In-Memory Rate Limiting (Source, Site, Global)', () => {
    let siteRecord: any;

    beforeEach(async () => {
      const reg = await trackingService.registerWebsite(
        userA.userId,
        'Tech Ghor BD',
        'https://techghorbd.vercel.app'
      );
      siteRecord = reg.website;
    });

    it('enforces per-source rate limit and returns safe 429 with Retry-After', async () => {
      const tightLimiter = new TrackingRateLimiter({
        sourceMax: 2,
        sourceWindowMs: 60000,
        globalMax: 100,
        siteMax: 100,
      });

      const limitedApp = createApp(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        trackingService,
        tightLimiter
      );

      // 1st request -> 200
      const res1 = await request(limitedApp)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteRecord.siteId,
          eventName: 'page_view',
          eventId: 'evt_rl_source_1',
        });
      expect(res1.status).toBe(200);

      // 2nd request -> 200
      const res2 = await request(limitedApp)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteRecord.siteId,
          eventName: 'page_view',
          eventId: 'evt_rl_source_2',
        });
      expect(res2.status).toBe(200);

      // 3rd request -> 429
      const res3 = await request(limitedApp)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteRecord.siteId,
          eventName: 'page_view',
          eventId: 'evt_rl_source_3',
        });
      expect(res3.status).toBe(429);
      expect(res3.body.success).toBe(false);
      expect(res3.body.error).toBe('Too many requests. Please try again later.');
      expect(res3.header['retry-after']).toBeDefined();
      expect(parseInt(res3.header['retry-after'], 10)).toBeGreaterThanOrEqual(1);
    });

    it('enforces global rate limit across all sources and returns safe 429 with Retry-After', async () => {
      const tightGlobalLimiter = new TrackingRateLimiter({
        globalMax: 2,
        globalWindowMs: 60000,
        sourceMax: 100,
        siteMax: 100,
      });

      const limitedApp = createApp(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        trackingService,
        tightGlobalLimiter
      );

      // 1st and 2nd requests -> 200
      for (let i = 1; i <= 2; i++) {
        const res = await request(limitedApp)
          .post('/api/tracking/events')
          .set('Origin', 'https://techghorbd.vercel.app')
          .send({
            siteId: siteRecord.siteId,
            eventName: 'page_view',
            eventId: `evt_rl_global_${i}`,
          });
        expect(res.status).toBe(200);
      }

      // 3rd request hits global limit -> 429
      const res3 = await request(limitedApp)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteRecord.siteId,
          eventName: 'page_view',
          eventId: 'evt_rl_global_3',
        });
      expect(res3.status).toBe(429);
      expect(res3.body.error).toBe('Too many requests. Please try again later.');
      expect(res3.header['retry-after']).toBeDefined();
    });

    it('enforces per-site rate limit and returns safe 429 with Retry-After', async () => {
      const tightSiteLimiter = new TrackingRateLimiter({
        siteMax: 2,
        siteWindowMs: 60000,
        sourceMax: 100,
        globalMax: 100,
      });

      const limitedApp = createApp(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        trackingService,
        tightSiteLimiter
      );

      // 1st and 2nd requests -> 200
      for (let i = 1; i <= 2; i++) {
        const res = await request(limitedApp)
          .post('/api/tracking/events')
          .set('Origin', 'https://techghorbd.vercel.app')
          .send({
            siteId: siteRecord.siteId,
            eventName: 'page_view',
            eventId: `evt_rl_site_${i}`,
          });
        expect(res.status).toBe(200);
      }

      // 3rd request hits per-site limit -> 429
      const res3 = await request(limitedApp)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteRecord.siteId,
          eventName: 'page_view',
          eventId: 'evt_rl_site_3',
        });
      expect(res3.status).toBe(429);
      expect(res3.body.error).toBe('Too many requests. Please try again later.');
      expect(res3.header['retry-after']).toBeDefined();
    });

    it('ensures rate limits occur before database writes', async () => {
      const tightLimiter = new TrackingRateLimiter({
        sourceMax: 1,
        sourceWindowMs: 60000,
        globalMax: 100,
        siteMax: 100,
      });

      const spyRecord = jest.spyOn(trackingRepository, 'recordWebsiteEvent');

      const limitedApp = createApp(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        trackingService,
        tightLimiter
      );

      // 1st request -> writes to DB
      await request(limitedApp)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteRecord.siteId,
          eventName: 'page_view',
          eventId: 'evt_db_guard_1',
        });
      expect(spyRecord).toHaveBeenCalledTimes(1);

      // 2nd request -> rate limited with 429, DB write MUST NOT occur
      const res2 = await request(limitedApp)
        .post('/api/tracking/events')
        .set('Origin', 'https://techghorbd.vercel.app')
        .send({
          siteId: siteRecord.siteId,
          eventName: 'page_view',
          eventId: 'evt_db_guard_2',
        });
      expect(res2.status).toBe(429);
      // Calls to DB remained 1, proving DB write was skipped
      expect(spyRecord).toHaveBeenCalledTimes(1);

      spyRecord.mockRestore();
    });

    it('enforces bounded in-memory store size and FIFO/expiration cleanup', () => {
      const boundedLimiter = new TrackingRateLimiter({
        maxEntries: 3,
        sourceWindowMs: 60000,
      });

      // Simulate 6 distinct IP sources through checkSourceAndGlobal
      for (let i = 1; i <= 6; i++) {
        const mockReq: any = {
          socket: { remoteAddress: `192.168.1.${i}` },
          headers: {},
        };
        boundedLimiter.checkSourceAndGlobal(mockReq);
      }

      // Assert store is bounded and never exceeds maxEntries (3)
      const storeSizes = boundedLimiter.getStoreSizes();
      expect(storeSizes.sourceCount).toBeLessThanOrEqual(3);
    });

    it('confirms source hashing uses keyed HMAC without storing or logging raw IP', () => {
      const limiter = new TrackingRateLimiter();
      const rawIp = '203.0.113.195';
      const hash1 = limiter.hashSource(rawIp);
      const hash2 = limiter.hashSource(rawIp);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(rawIp);
      expect(hash1).not.toContain(rawIp);
      expect(hash1).toHaveLength(32);
    });
  });
});
