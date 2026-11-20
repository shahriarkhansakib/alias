import { Request, Response, NextFunction } from 'express';
import { TrackingService } from '../services/tracking.service';
import { TrackingRateLimiter } from '../utils/tracking-rate-limiter';
import { validateAndNormalizeOrigin } from '../utils/origin-validator';

export class TrackingController {
  private trackingService: TrackingService;
  public readonly rateLimiter: TrackingRateLimiter;

  constructor(trackingService?: TrackingService, rateLimiter?: TrackingRateLimiter) {
    this.trackingService = trackingService || new TrackingService();
    this.rateLimiter = rateLimiter || new TrackingRateLimiter();
  }

  // --- Products ---

  createProduct = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const { name, destinationUrl } = req.body;
      const product = await this.trackingService.createProduct(userId, name, destinationUrl);
      res.status(201).json({ success: true, product });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || 'Failed to create product.' });
    }
  };

  getProducts = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const products = await this.trackingService.getProducts(userId);
      res.json({ success: true, products });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to load products.' });
    }
  };

  // --- Campaigns ---

  createCampaign = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const { productId, name } = req.body;
      const campaign = await this.trackingService.createCampaign(userId, productId, name);
      res.status(201).json({ success: true, campaign });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || 'Failed to create campaign.' });
    }
  };

  getCampaigns = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const productId = req.query.productId as string | undefined;
      const campaigns = await this.trackingService.getCampaigns(userId, productId);
      res.json({ success: true, campaigns });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to load campaigns.' });
    }
  };

  // --- Tracked Links ---

  createTrackedLink = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const { campaignId, label } = req.body;
      const link = await this.trackingService.createTrackedLink(userId, campaignId, label);
      res.status(201).json({ success: true, link });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || 'Failed to create tracked link.' });
    }
  };

  getTrackedLinks = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const campaignId = req.query.campaignId as string | undefined;
      const links = await this.trackingService.getTrackedLinks(userId, campaignId);
      res.json({ success: true, links });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to load tracked links.' });
    }
  };

  // --- Hierarchical Stats ---

  getStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const stats = await this.trackingService.getStats(userId);
      res.json({ success: true, ...stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to fetch tracking stats.' });
    }
  };

  // --- Public Redirect ---

  handlePublicRedirect = async (req: Request, res: Response): Promise<void> => {
    // 1. Strictly forbid query override attempts (Open-Redirect Prevention)
    const query = req.query || {};
    if (
      query.url ||
      query.destination ||
      query.target ||
      query.redirect ||
      query.dest ||
      query.r
    ) {
      res.status(400).json({
        success: false,
        error: 'Redirect destination override via query parameters is forbidden.',
      });
      return;
    }

    const rawSlug = req.params.slug;
    const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
    if (!slug || typeof slug !== 'string') {
      res.status(404).json({ success: false, error: 'Tracked link not found.' });
      return;
    }

    const rawUserAgent = req.headers['user-agent'];
    const userAgent = Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent;
    const result = await this.trackingService.handleRedirect(slug, userAgent);

    if (!result) {
      res.status(404).json({ success: false, error: 'Tracked link not found.' });
      return;
    }

    // Redirect to verified destination URL stored server-side
    res.redirect(302, result.destinationUrl);
  };

  // ==========================================
  // Phase 2: Connect Website & Public Ingestion
  // ==========================================

  registerWebsite = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const { name, origin } = req.body;
      const result = await this.trackingService.registerWebsite(userId, name, origin);
      res.status(201).json({ success: true, ...result });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || 'Failed to register website.' });
    }
  };

  getWebsites = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const websites = await this.trackingService.getWebsites(userId);
      res.json({ success: true, websites });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to load websites.' });
    }
  };

  getWebsiteStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const websiteId = req.query.websiteId as string | undefined;
      const stats = await this.trackingService.getWebsiteStats(userId, websiteId);
      res.json({ success: true, ...stats });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to fetch website stats.' });
    }
  };

  // --- Public Event Ingestion & Script Serving ---

  handleServeScript = (_req: Request, res: Response): void => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(this.trackingService.getTrackingScriptJs());
  };

  handleEventPreflight = (req: Request, res: Response): void => {
    const rawOrigin = req.headers.origin;
    const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    if (origin && typeof origin === 'string') {
      const val = validateAndNormalizeOrigin(origin);
      if (val.isValid && val.origin) {
        // Exact-origin only: no wildcard (*), no credentials
        res.setHeader('Access-Control-Allow-Origin', val.origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
      }
    }
    res.status(204).end();
  };

  /**
   * Pre-body middleware for POST /api/tracking/events.
   * - Checks layered source and global rate limits BEFORE JSON body parsing.
   * - Enforces non-empty and well-formed Origin header BEFORE body parsing.
   * - Never persists or logs raw IP or User-Agent.
   */
  handlePreBodyIngest = (req: Request, res: Response, next: NextFunction): void => {
    // 1. Layered rate limiting: source & global (before JSON body parsing)
    const rateLimit = this.rateLimiter.checkSourceAndGlobal(req);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfterSeconds));
      res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
      return;
    }

    // 2. Origin validation: Require non-empty Origin header
    const rawOrigin = req.headers.origin;
    const requestOrigin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    if (!requestOrigin || typeof requestOrigin !== 'string' || !requestOrigin.trim()) {
      res.status(403).json({ success: false, error: 'Origin not authorized.' });
      return;
    }

    // 3. Normalize origin and reject malformed
    const valResult = validateAndNormalizeOrigin(requestOrigin);
    if (!valResult.isValid || !valResult.origin) {
      res.status(403).json({ success: false, error: 'Origin not authorized.' });
      return;
    }

    (req as any).validatedOrigin = valResult.origin;
    next();
  };

  handlePublicEventIngest = async (req: Request, res: Response): Promise<void> => {
    const validatedOrigin = (req as any).validatedOrigin;

    try {
      const body = req.body || {};
      const siteId = body.siteId;

      if (!siteId || typeof siteId !== 'string' || !siteId.trim()) {
        res.status(400).json({ success: false, error: 'siteId is required.' });
        return;
      }

      // 4. Layered rate limiting: per-site (evaluated before database writes)
      const siteLimit = this.rateLimiter.checkSite(siteId.trim());
      if (!siteLimit.allowed) {
        res.setHeader('Retry-After', String(siteLimit.retryAfterSeconds));
        res.status(429).json({ success: false, error: 'Too many requests. Please try again later.' });
        return;
      }

      const rawUserAgent = req.headers['user-agent'];
      const userAgent = Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent;

      const result = await this.trackingService.recordWebsiteEvent(
        {
          siteId: siteId.trim(),
          eventName: body.eventName,
          eventId: body.eventId,
          productId: body.productId,
        },
        validatedOrigin,
        userAgent
      );

      // Route-specific CORS response headers: exact origin only, no wildcard, no credentials
      res.setHeader('Access-Control-Allow-Origin', validatedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      res.status(200).json(result);
    } catch (err: any) {
      const message = err.message || 'Failed to record event.';
      const isOriginError = message.includes('Origin') || message.includes('not authorized');
      const isNotFound = message.includes('Website with siteId') || message.includes('Tracked link not found');

      if (isOriginError) {
        // Generic 403: Never echo the supplied Origin or siteId in errors
        res.status(403).json({ success: false, error: 'Origin not authorized.' });
        return;
      }

      if (isNotFound) {
        res.status(404).json({ success: false, error: 'Website not found.' });
        return;
      }

      res.status(400).json({ success: false, error: message });
    }
  };
}
