import request from 'supertest';
import { createApp } from '../src/app';
import { TrackingService } from '../src/tracking/services/tracking.service';
import { TrackingRepositoryService } from '../src/tracking/services/tracking-repository.service';
import { validateDestinationUrl } from '../src/tracking/utils/url-validator';
import { isLinkPreviewBot } from '../src/tracking/utils/bot-detector';
import { generateToken } from '../src/auth/auth.service';
import { config, validateConfig } from '../src/config/env';

describe('Phase 1: Product/Campaign Link Click Tracking', () => {
  let app: any;
  let trackingRepository: TrackingRepositoryService;
  let trackingService: TrackingService;

  const userA = { userId: 'user_a_123', role: 'user' };
  const userB = { userId: 'user_b_456', role: 'user' };
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

  // --- 1. Destination URL Validation ---

  describe('Destination URL Validation & SSRF Prevention', () => {
    it('accepts valid public HTTPS and HTTP URLs', () => {
      const res1 = validateDestinationUrl('https://techghorbd.vercel.app/');
      expect(res1.isValid).toBe(true);
      expect(res1.normalizedUrl).toBe('https://techghorbd.vercel.app/');

      const res2 = validateDestinationUrl('http://example.com/products/item-456?ref=summer');
      expect(res2.isValid).toBe(true);
      expect(res2.normalizedUrl).toBe('http://example.com/products/item-456?ref=summer');
    });

    it('rejects non-HTTP/HTTPS protocols', () => {
      expect(validateDestinationUrl('javascript:alert(1)').isValid).toBe(false);
      expect(validateDestinationUrl('data:text/html;base64,PHNjcmlwdD4=').isValid).toBe(false);
      expect(validateDestinationUrl('file:///etc/passwd').isValid).toBe(false);
      expect(validateDestinationUrl('ftp://example.com/file').isValid).toBe(false);
    });

    it('rejects embedded user credentials in destination URLs', () => {
      const res = validateDestinationUrl('https://admin:secretpassword@example.com/page');
      expect(res.isValid).toBe(false);
      expect(res.error).toMatch(/credentials/i);
    });

    it('rejects localhost, loopback, and internal local names', () => {
      expect(validateDestinationUrl('http://localhost:3000/test').isValid).toBe(false);
      expect(validateDestinationUrl('http://127.0.0.1:8080/dashboard').isValid).toBe(false);
      expect(validateDestinationUrl('http://[::1]:5000').isValid).toBe(false);
      expect(validateDestinationUrl('http://app.internal/secret').isValid).toBe(false);
      expect(validateDestinationUrl('http://myserver.local').isValid).toBe(false);
      expect(validateDestinationUrl('http://portal.localhost').isValid).toBe(false);
    });

    it('rejects private RFC 1918 and link-local IP addresses', () => {
      expect(validateDestinationUrl('http://10.0.0.1/admin').isValid).toBe(false);
      expect(validateDestinationUrl('http://192.168.1.1/router').isValid).toBe(false);
      expect(validateDestinationUrl('http://172.16.0.5/api').isValid).toBe(false);
      expect(validateDestinationUrl('http://172.31.255.255/').isValid).toBe(false);
      expect(validateDestinationUrl('http://169.254.169.254/latest/meta-data/').isValid).toBe(false);
      expect(validateDestinationUrl('http://0.0.0.0/').isValid).toBe(false);
    });

    it('rejects malformed or empty inputs', () => {
      expect(validateDestinationUrl('').isValid).toBe(false);
      expect(validateDestinationUrl('not-a-url').isValid).toBe(false);
      expect(validateDestinationUrl(null as any).isValid).toBe(false);
    });
  });

  // --- 2. Link Preview Bot Detection ---

  describe('Link Preview Bot Detector', () => {
    it('detects Facebook/Meta preview crawlers', () => {
      expect(isLinkPreviewBot('facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.html)')).toBe(true);
      expect(isLinkPreviewBot('facebookexternalhit/1.1')).toBe(true);
      expect(isLinkPreviewBot('Facebot')).toBe(true);
      expect(isLinkPreviewBot('Meta-ExternalAgent/1.0')).toBe(true);
    });

    it('detects X/Twitter, LinkedIn, WhatsApp, and Slack preview crawlers', () => {
      expect(isLinkPreviewBot('Twitterbot/1.0')).toBe(true);
      expect(isLinkPreviewBot('LinkedInBot/1.0 (compatible; Mozilla/5.0...)')).toBe(true);
      expect(isLinkPreviewBot('WhatsApp/2.21.12.21 A')).toBe(true);
      expect(isLinkPreviewBot('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)')).toBe(true);
      expect(isLinkPreviewBot('TelegramBot (like TwitterBot)')).toBe(true);
      expect(isLinkPreviewBot('Discordbot/2.0')).toBe(true);
    });

    it('returns false for standard human desktop and mobile browsers', () => {
      expect(isLinkPreviewBot('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe(false);
      expect(isLinkPreviewBot('Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1')).toBe(false);
      expect(isLinkPreviewBot('')).toBe(false);
      expect(isLinkPreviewBot(undefined)).toBe(false);
    });
  });

  // --- 3. Exact Multi-User Isolation ---

  describe('Authentication & Exact Multi-User Isolation', () => {
    it('rejects unauthenticated requests to tracking APIs with 401', async () => {
      const res = await request(app).get('/api/social/tracking/products');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('isolates products, campaigns, and links between User A and User B', async () => {
      // User A creates a product
      const prodA = await request(app)
        .post('/api/social/tracking/products')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ name: 'Gadget Pro', destinationUrl: 'https://techghorbd.vercel.app/' });
      expect(prodA.status).toBe(201);
      const prodAId = prodA.body.product.id;

      // User A creates a campaign
      const campA = await request(app)
        .post('/api/social/tracking/campaigns')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ productId: prodAId, name: 'Launch Push' });
      expect(campA.status).toBe(201);
      const campAId = campA.body.campaign.id;

      // User A creates a tracked link
      const linkA = await request(app)
        .post('/api/social/tracking/links')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ campaignId: campAId, label: 'Facebook post 1' });
      expect(linkA.status).toBe(201);

      // User B lists products -> empty
      const listProdB = await request(app)
        .get('/api/social/tracking/products')
        .set('Cookie', [`auth_token=${tokenB}`]);
      expect(listProdB.status).toBe(200);
      expect(listProdB.body.products).toHaveLength(0);

      // User B lists campaigns -> empty
      const listCampB = await request(app)
        .get('/api/social/tracking/campaigns')
        .set('Cookie', [`auth_token=${tokenB}`]);
      expect(listCampB.status).toBe(200);
      expect(listCampB.body.campaigns).toHaveLength(0);

      // User B cannot create a campaign for User A's product
      const hijackCamp = await request(app)
        .post('/api/social/tracking/campaigns')
        .set('Cookie', [`auth_token=${tokenB}`])
        .send({ productId: prodAId, name: 'Malicious Campaign' });
      expect(hijackCamp.status).toBe(400);

      // User B cannot create a link for User A's campaign
      const hijackLink = await request(app)
        .post('/api/social/tracking/links')
        .set('Cookie', [`auth_token=${tokenB}`])
        .send({ campaignId: campAId, label: 'Hijack attempt' });
      expect(hijackLink.status).toBe(400);

      // User B tracking stats show 0 products and 0 clicks
      const statsB = await request(app)
        .get('/api/social/tracking/stats')
        .set('Cookie', [`auth_token=${tokenB}`]);
      expect(statsB.status).toBe(200);
      expect(statsB.body.totalEligibleClicks).toBe(0);
      expect(statsB.body.products).toHaveLength(0);
    });
  });

  // --- 4. Slug Uniqueness & Generation ---

  describe('Random Slug Uniqueness & Integrity', () => {
    it('generates distinct, cryptographically unguessable slugs', async () => {
      const prod = await request(app)
        .post('/api/social/tracking/products')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ name: 'Smart Watch', destinationUrl: 'https://example.com/watch' });

      const camp = await request(app)
        .post('/api/social/tracking/campaigns')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ productId: prod.body.product.id, name: 'Holiday Sale' });

      const slugs = new Set<string>();
      for (let i = 0; i < 10; i++) {
        const link = await request(app)
          .post('/api/social/tracking/links')
          .set('Cookie', [`auth_token=${tokenA}`])
          .send({ campaignId: camp.body.campaign.id, label: `Post ${i}` });
        expect(link.status).toBe(201);
        const slug = link.body.link.slug;
        expect(slug).toBeDefined();
        expect(slug.length).toBeGreaterThanOrEqual(8);
        expect(slugs.has(slug)).toBe(false);
        slugs.add(slug);
      }
      expect(slugs.size).toBe(10);
    });
  });

  // --- 5. Public Redirect & Open-Redirect Protection ---

  describe('Public Redirect Route & Open-Redirect Protection', () => {
    let testSlug: string;
    const destinationUrl = 'https://techghorbd.vercel.app/';

    beforeEach(async () => {
      const prod = await request(app)
        .post('/api/social/tracking/products')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ name: 'Headphones', destinationUrl });

      const camp = await request(app)
        .post('/api/social/tracking/campaigns')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ productId: prod.body.product.id, name: 'Campaign 1' });

      const link = await request(app)
        .post('/api/social/tracking/links')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ campaignId: camp.body.campaign.id, label: 'Facebook Post 1' });

      testSlug = link.body.link.slug;
    });

    it('redirects with 302 to the server-stored destination URL', async () => {
      const res = await request(app).get(`/r/${testSlug}`);
      expect(res.status).toBe(302);
      expect(res.header.location).toBe(destinationUrl);
    });

    it('strictly rejects open-redirect query parameter override attempts with 400', async () => {
      const res1 = await request(app).get(`/r/${testSlug}?url=https://malicious-site.com`);
      expect(res1.status).toBe(400);
      expect(res1.body.success).toBe(false);
      expect(res1.body.error).toMatch(/forbidden/i);

      const res2 = await request(app).get(`/r/${testSlug}?destination=https://malicious-site.com`);
      expect(res2.status).toBe(400);

      const res3 = await request(app).get(`/r/${testSlug}?redirect=https://malicious-site.com`);
      expect(res3.status).toBe(400);
    });

    it('returns 404 for non-existent slugs', async () => {
      const res = await request(app).get('/r/non_existent_slug_12345');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // --- 6. Click Counting & Bot Preview Filtering ---

  describe('Eligible Click Counting & Bot Preview Filtering', () => {
    let testSlug: string;

    beforeEach(async () => {
      const prod = await request(app)
        .post('/api/social/tracking/products')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ name: 'Laptop Stand', destinationUrl: 'https://example.com/laptop-stand' });

      const camp = await request(app)
        .post('/api/social/tracking/campaigns')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ productId: prod.body.product.id, name: 'Summer Campaign' });

      const link = await request(app)
        .post('/api/social/tracking/links')
        .set('Cookie', [`auth_token=${tokenA}`])
        .send({ campaignId: camp.body.campaign.id, label: 'FB promo 1' });

      testSlug = link.body.link.slug;
    });

    it('increments eligible clicks for standard browser visits', async () => {
      // 1st click
      const res1 = await request(app)
        .get(`/r/${testSlug}`)
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36');
      expect(res1.status).toBe(302);

      // 2nd click
      const res2 = await request(app)
        .get(`/r/${testSlug}`)
        .set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15');
      expect(res2.status).toBe(302);

      // Verify stats
      const stats = await request(app)
        .get('/api/social/tracking/stats')
        .set('Cookie', [`auth_token=${tokenA}`]);
      expect(stats.status).toBe(200);
      expect(stats.body.totalEligibleClicks).toBe(2);
      expect(stats.body.metricLabel).toBe('Tracked clicks (not unique visitors)');
      expect(stats.body.products[0].eligibleClicks).toBe(2);
      expect(stats.body.products[0].campaigns[0].eligibleClicks).toBe(2);
      expect(stats.body.products[0].campaigns[0].links[0].eligibleClicks).toBe(2);
    });

    it('redirects preview bots with 302 but excludes them from eligible click counts', async () => {
      // Facebook External Hit bot request
      const fbBotRes = await request(app)
        .get(`/r/${testSlug}`)
        .set('User-Agent', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.html)');
      expect(fbBotRes.status).toBe(302);
      expect(fbBotRes.header.location).toBe('https://example.com/laptop-stand');

      // Twitter bot request
      const twitterBotRes = await request(app)
        .get(`/r/${testSlug}`)
        .set('User-Agent', 'Twitterbot/1.0');
      expect(twitterBotRes.status).toBe(302);

      // WhatsApp preview request
      const waBotRes = await request(app)
        .get(`/r/${testSlug}`)
        .set('User-Agent', 'WhatsApp/2.21.12.21 A');
      expect(waBotRes.status).toBe(302);

      // Slack preview request
      const slackBotRes = await request(app)
        .get(`/r/${testSlug}`)
        .set('User-Agent', 'Slackbot-LinkExpanding 1.0');
      expect(slackBotRes.status).toBe(302);

      // Check stats: all 4 bot preview requests redirected, but eligible click count must remain 0
      const stats = await request(app)
        .get('/api/social/tracking/stats')
        .set('Cookie', [`auth_token=${tokenA}`]);
      expect(stats.status).toBe(200);
      expect(stats.body.totalEligibleClicks).toBe(0);
      expect(stats.body.products[0].eligibleClicks).toBe(0);
      expect(stats.body.products[0].campaigns[0].links[0].eligibleClicks).toBe(0);
    });
  });

  // --- 7. Configuration & Public URL Verification ---

  describe('Configuration & Public URL Verification', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalTrackingBase = process.env.PUBLIC_TRACKING_BASE_URL;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      process.env.PUBLIC_TRACKING_BASE_URL = originalTrackingBase;
    });

    it('builds links from PUBLIC_TRACKING_BASE_URL when configured', () => {
      process.env.PUBLIC_TRACKING_BASE_URL = 'https://trk.techghorbd.com';
      const svc = new TrackingService(trackingRepository);
      const url = svc.buildTrackedUrl('testslug123');
      expect(url).toBe('https://trk.techghorbd.com/r/testslug123');
    });

    it('falls back safely to localhost in development with warning when unconfigured', () => {
      delete process.env.PUBLIC_TRACKING_BASE_URL;
      const svc = new TrackingService(trackingRepository);
      const info = svc.getBaseUrlInfo();
      expect(info.isConfigured).toBe(false);
      expect(info.isLocalhost).toBe(true);
      expect(info.warning).toMatch(/localhost/i);
    });

    it('throws in production when PUBLIC_TRACKING_BASE_URL is missing or not HTTPS', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.PUBLIC_TRACKING_BASE_URL;
      expect(() => validateConfig()).toThrow(/PUBLIC_TRACKING_BASE_URL is required in production/i);

      process.env.PUBLIC_TRACKING_BASE_URL = 'http://insecure-domain.com';
      expect(() => validateConfig()).toThrow(/must use HTTPS in production/i);

      process.env.PUBLIC_TRACKING_BASE_URL = 'https://trk.mybusiness.com';
      expect(() => validateConfig()).not.toThrow();
    });
  });
});
