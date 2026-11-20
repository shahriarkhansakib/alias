import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { TrackingRepositoryService } from './tracking-repository.service';
import { validateDestinationUrl } from '../utils/url-validator';
import { validateAndNormalizeOrigin } from '../utils/origin-validator';
import { isLinkPreviewBot } from '../utils/bot-detector';
import { config } from '../../config/env';
import {
  ProductRecord,
  CampaignRecord,
  TrackedLinkRecord,
  TrackingStatsResult,
  TrackingBaseUrlInfo,
  TrackingWebsiteRecord,
  WebsiteStatsResult,
  WebsiteStatsProductItem,
} from '../types/tracking.types';

export class TrackingService {
  private repository: TrackingRepositoryService;

  constructor(repository?: TrackingRepositoryService) {
    this.repository = repository || new TrackingRepositoryService();
  }

  /**
   * Evaluates the tracking base URL configuration.
   */
  public getBaseUrlInfo(): TrackingBaseUrlInfo {
    const rawUrl = config.publicTrackingBaseUrl;
    if (rawUrl && typeof rawUrl === 'string' && rawUrl.trim()) {
      try {
        const parsed = new URL(rawUrl.trim());
        const isHttps = parsed.protocol === 'https:';
        const isLocalhost =
          parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

        let warning: string | undefined;
        if (config.nodeEnv === 'production' && !isHttps) {
          warning =
            'PUBLIC_TRACKING_BASE_URL must use https:// in production for tracked links to be reachable externally.';
        }

        return {
          baseUrl: rawUrl.trim().replace(/\/+$/, ''),
          isConfigured: true,
          isHttps,
          isLocalhost,
          warning,
        };
      } catch (_e) {
        return {
          baseUrl: '',
          isConfigured: false,
          isHttps: false,
          isLocalhost: false,
          warning: 'PUBLIC_TRACKING_BASE_URL is invalid.',
        };
      }
    }

    // Default fallback to local server
    const localBase = `http://localhost:${config.port}`;
    return {
      baseUrl: localBase,
      isConfigured: false,
      isHttps: false,
      isLocalhost: true,
      warning:
        config.nodeEnv === 'production'
          ? 'PUBLIC_TRACKING_BASE_URL is required in production. Tracked links will not be reachable by external visitors.'
          : 'Tracking links currently use localhost for local testing. A public HTTPS base URL is required for external visitors to reach them.',
    };
  }

  /**
   * Generates a full tracked link URL from a slug.
   */
  public buildTrackedUrl(slug: string): string {
    const info = this.getBaseUrlInfo();
    const base = info.baseUrl || `http://localhost:${config.port}`;
    return `${base}/r/${encodeURIComponent(slug)}`;
  }

  /**
   * Generates a cryptographically random, collision-resistant slug.
   * Produces an unguessable 8-character base64url string (~48 bits entropy).
   */
  public generateSlug(): string {
    return crypto.randomBytes(6).toString('base64url');
  }

  // --- Product Management ---

  public async createProduct(
    userId: string,
    name: string,
    destinationUrl: string
  ): Promise<ProductRecord> {
    if (!userId || !userId.trim()) {
      throw new Error('Authentication required.');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Product name is required.');
    }

    const valResult = validateDestinationUrl(destinationUrl);
    if (!valResult.isValid || !valResult.normalizedUrl) {
      throw new Error(valResult.error || 'Invalid destination URL.');
    }

    const now = new Date().toISOString();
    const product: ProductRecord = {
      id: `prod_${uuidv4()}`,
      userId: userId.trim(),
      name: name.trim(),
      destinationUrl: valResult.normalizedUrl,
      createdAt: now,
      updatedAt: now,
    };

    return this.repository.createProduct(product);
  }

  public async getProducts(userId: string): Promise<ProductRecord[]> {
    if (!userId || !userId.trim()) return [];
    return this.repository.findProductsByUserId(userId.trim());
  }

  // --- Campaign Management ---

  public async createCampaign(
    userId: string,
    productId: string,
    name: string
  ): Promise<CampaignRecord> {
    if (!userId || !userId.trim()) {
      throw new Error('Authentication required.');
    }
    if (!productId || typeof productId !== 'string' || !productId.trim()) {
      throw new Error('productId is required.');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Campaign name is required.');
    }

    // Verify product ownership by authenticated user
    const product = await this.repository.findProductById(productId.trim(), userId.trim());
    if (!product) {
      throw new Error(`Product '${productId}' not found or not owned by requesting user.`);
    }

    const now = new Date().toISOString();
    const campaign: CampaignRecord = {
      id: `camp_${uuidv4()}`,
      userId: userId.trim(),
      productId: product.id,
      name: name.trim(),
      createdAt: now,
      updatedAt: now,
    };

    return this.repository.createCampaign(campaign);
  }

  public async getCampaigns(userId: string, productId?: string): Promise<CampaignRecord[]> {
    if (!userId || !userId.trim()) return [];
    return this.repository.findCampaignsByUserId(userId.trim(), productId);
  }

  // --- Tracked Link Management ---

  public async createTrackedLink(
    userId: string,
    campaignId: string,
    label?: string
  ): Promise<TrackedLinkRecord & { trackedUrl: string }> {
    if (!userId || !userId.trim()) {
      throw new Error('Authentication required.');
    }
    if (!campaignId || typeof campaignId !== 'string' || !campaignId.trim()) {
      throw new Error('campaignId is required.');
    }

    // Verify campaign ownership by authenticated user
    const campaign = await this.repository.findCampaignById(campaignId.trim(), userId.trim());
    if (!campaign) {
      throw new Error(`Campaign '${campaignId}' not found or not owned by requesting user.`);
    }

    // Load parent product to inherit destination URL
    const product = await this.repository.findProductById(campaign.productId, userId.trim());
    if (!product) {
      throw new Error('Associated product not found.');
    }

    // Generate unguessable slug with collision check
    let slug = this.generateSlug();
    let existing = await this.repository.findTrackedLinkBySlug(slug);
    let attempts = 0;
    while (existing && attempts < 5) {
      slug = this.generateSlug();
      existing = await this.repository.findTrackedLinkBySlug(slug);
      attempts++;
    }

    const now = new Date().toISOString();
    const link: TrackedLinkRecord = {
      id: `trk_${uuidv4()}`,
      userId: userId.trim(),
      campaignId: campaign.id,
      productId: product.id,
      slug,
      destinationUrl: product.destinationUrl,
      label: label && typeof label === 'string' && label.trim() ? label.trim() : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.repository.createTrackedLink(link);
    return {
      ...saved,
      trackedUrl: this.buildTrackedUrl(saved.slug),
    };
  }

  public async getTrackedLinks(
    userId: string,
    campaignId?: string
  ): Promise<Array<TrackedLinkRecord & { trackedUrl: string }>> {
    if (!userId || !userId.trim()) return [];
    const links = await this.repository.findTrackedLinksByUserId(userId.trim(), campaignId);
    return links.map((l) => ({
      ...l,
      trackedUrl: this.buildTrackedUrl(l.slug),
    }));
  }

  // --- Public Redirect Flow ---

  /**
   * Resolves a slug, determines bot status, logs click, and returns the destination.
   * Prevents open-redirects: destination is loaded strictly from the stored record.
   * Raw IPs and full User-Agents are NEVER stored.
   */
  public async handleRedirect(
    slug: string,
    userAgent?: string
  ): Promise<{ destinationUrl: string; isBot: boolean } | null> {
    if (!slug || typeof slug !== 'string' || !slug.trim()) {
      return null;
    }

    const link = await this.repository.findTrackedLinkBySlug(slug.trim());
    if (!link) {
      return null;
    }

    const isBot = isLinkPreviewBot(userAgent);

    // Record click event without PII
    const now = new Date().toISOString();
    await this.repository.recordClick({
      id: `clk_${uuidv4()}`,
      linkId: link.id,
      campaignId: link.campaignId,
      productId: link.productId,
      userId: link.userId,
      isBot,
      createdAt: now,
    });

    return {
      destinationUrl: link.destinationUrl,
      isBot,
    };
  }

  // --- Hierarchical Stats ---

  public async getStats(userId: string): Promise<TrackingStatsResult> {
    if (!userId || !userId.trim()) {
      throw new Error('Authentication required.');
    }

    const configInfo = this.getBaseUrlInfo();
    const { products, totalEligibleClicks } = await this.repository.getHierarchicalStats(
      userId.trim(),
      (slug) => this.buildTrackedUrl(slug)
    );

    return {
      metricLabel: 'Tracked clicks (not unique visitors)',
      totalEligibleClicks,
      config: configInfo,
      products,
    };
  }

  // ==========================================
  // Phase 2: Connect Website & Activity Tracking
  // ==========================================

  public generateSiteId(): string {
    return `site_${crypto.randomBytes(8).toString('hex')}`;
  }

  public buildSnippet(siteId: string): string {
    const info = this.getBaseUrlInfo();
    const base = info.baseUrl || `http://localhost:${config.port}`;
    return `<script defer src="${base}/t.js" data-site-id="${siteId}"></script>`;
  }

  public async registerWebsite(
    userId: string,
    name: string,
    originInput: string
  ): Promise<{ website: TrackingWebsiteRecord; snippet: string }> {
    if (!userId || !userId.trim()) {
      throw new Error('Authentication required.');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('Website name is required.');
    }

    const valResult = validateAndNormalizeOrigin(originInput);
    if (!valResult.isValid || !valResult.origin) {
      throw new Error(valResult.error || 'Invalid website origin.');
    }

    const siteId = this.generateSiteId();
    const now = new Date().toISOString();

    const website: TrackingWebsiteRecord = {
      id: `web_${uuidv4()}`,
      userId: userId.trim(),
      siteId,
      name: name.trim(),
      origin: valResult.origin,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.repository.createWebsite(website);
    return {
      website: saved,
      snippet: this.buildSnippet(saved.siteId),
    };
  }

  public async getWebsites(userId: string): Promise<TrackingWebsiteRecord[]> {
    if (!userId || !userId.trim()) return [];
    return this.repository.findWebsitesByUserId(userId.trim());
  }

  public async getWebsiteById(
    websiteId: string,
    userId: string
  ): Promise<TrackingWebsiteRecord | null> {
    if (!userId || !userId.trim() || !websiteId || !websiteId.trim()) return null;
    return this.repository.findWebsiteById(websiteId.trim(), userId.trim());
  }

  public async findWebsiteBySiteId(siteId: string): Promise<TrackingWebsiteRecord | null> {
    if (!siteId || typeof siteId !== 'string' || !siteId.trim()) return null;
    return this.repository.findWebsiteBySiteId(siteId.trim());
  }

  /**
   * Ingest a public website event.
   * - Strict event allowlist: 'page_view' | 'product_click'.
   * - Resolves userId and site server-side from siteId.
   * - Origin check against registered website origin.
   * - Product ownership check: product must belong to same owner as site.
   * - EventId idempotency.
   * - No personal data or visitor identifiers stored.
   */
  public async recordWebsiteEvent(
    payload: {
      siteId?: string;
      eventName?: string;
      eventId?: string;
      productId?: string;
    },
    requestOrigin?: string,
    userAgent?: string
  ): Promise<{ success: boolean; duplicate?: boolean }> {
    if (!payload?.siteId || typeof payload.siteId !== 'string' || !payload.siteId.trim()) {
      throw new Error('siteId is required.');
    }

    // 1. Strict event allowlist
    const eventName = (payload.eventName || '').trim();
    if (eventName !== 'page_view' && eventName !== 'product_click') {
      throw new Error(`Invalid eventName '${eventName}'. Allowed events are 'page_view' and 'product_click'.`);
    }

    if (!payload.eventId || typeof payload.eventId !== 'string' || !payload.eventId.trim()) {
      throw new Error('eventId is required for request idempotency.');
    }

    // 2. Resolve website & owner server-side
    const site = await this.repository.findWebsiteBySiteId(payload.siteId.trim());
    if (!site) {
      throw new Error(`Website with siteId '${payload.siteId}' not found.`);
    }

    // 3. Origin check (route-specific allowlist check)
    // Non-empty Origin is strictly required and must exactly match the registered site origin.
    // Origin is a browser allowlist, not cryptographic proof or authentication.
    if (!requestOrigin || typeof requestOrigin !== 'string' || !requestOrigin.trim()) {
      throw new Error('Origin not authorized.');
    }
    const valReq = validateAndNormalizeOrigin(requestOrigin);
    const valSite = validateAndNormalizeOrigin(site.origin);
    if (!valReq.isValid || !valSite.isValid || valReq.origin !== valSite.origin) {
      throw new Error('Origin not authorized.');
    }

    // 4. Product ownership check (for product_click)
    let validatedProductId: string | undefined = undefined;
    if (eventName === 'product_click' && payload.productId) {
      const rawPid = String(payload.productId).trim();
      const prod = await this.repository.findProductById(rawPid, site.userId);
      if (!prod) {
        throw new Error(`Product '${rawPid}' is invalid or not owned by the registered website owner.`);
      }
      validatedProductId = prod.id;
    }

    // 5. Bot filtering & bounded storage
    // Apply limits to bot/crawler traffic too. Keep bots out of eligible counts and do not create unbounded bot-event rows.
    const isBot = isLinkPreviewBot(userAgent);
    if (isBot) {
      return {
        success: true,
        duplicate: false,
      };
    }

    // 6. Record event (Idempotent by website_id + event_id)
    const now = new Date().toISOString();
    const recordResult = await this.repository.recordWebsiteEvent({
      id: `wevt_${uuidv4()}`,
      websiteId: site.id,
      userId: site.userId,
      eventName,
      eventId: payload.eventId.trim(),
      productId: validatedProductId,
      isBot,
      createdAt: now,
    });

    return {
      success: true,
      duplicate: !recordResult.inserted,
    };
  }

  /**
   * Get website activity reporting for an authenticated user.
   */
  public async getWebsiteStats(
    userId: string,
    websiteId?: string
  ): Promise<WebsiteStatsResult> {
    if (!userId || !userId.trim()) {
      throw new Error('Authentication required.');
    }

    const configInfo = this.getBaseUrlInfo();
    const products = await this.repository.findProductsByUserId(userId.trim());
    const websites = await this.repository.findWebsitesByUserId(userId.trim());
    const statsData = await this.repository.getWebsiteActivityStats(userId.trim(), websiteId);

    const activeSite = statsData.website;
    const snippet = activeSite ? this.buildSnippet(activeSite.siteId) : '';
    const installationPending =
      statsData.totalPageViews === 0 && statsData.totalProductClicks === 0;

    const productItems: WebsiteStatsProductItem[] = products.map((p) => ({
      id: p.id,
      name: p.name,
      destinationUrl: p.destinationUrl,
      productClicks: statsData.productClickCounts.get(p.id) || 0,
      trackAttribute: `data-track-product-id="${p.id}"`,
    }));

    let warning: string | undefined = undefined;
    if (configInfo.isLocalhost) {
      warning =
        'Localhost backend active: External HTTPS websites (e.g. Vercel) cannot reliably send tracking events to a localhost backend due to browser mixed-content and network restrictions. A public HTTPS base URL (PUBLIC_TRACKING_BASE_URL) is required for real visitor tracking.';
    } else if (configInfo.warning) {
      warning = configInfo.warning;
    }

    return {
      metricLabel: 'Website events & product clicks (approximate browser events, not unique visitors or purchases)',
      website: activeSite,
      websites,
      snippet,
      installationPending,
      totalPageViews: statsData.totalPageViews,
      totalProductClicks: statsData.totalProductClicks,
      products: productItems,
      warning,
      isLocalhost: configInfo.isLocalhost,
      baseUrl: configInfo.baseUrl,
    };
  }

  /**
   * Generates the client-side lightweight first-party tracking JavaScript (t.js).
   * Does NOT prevent or delay normal navigation.
   * Does NOT collect personal identifiers, cookies, or persistent visitor IDs.
   */
  public getTrackingScriptJs(): string {
    return `(function(){'use strict';try{var s=document.currentScript||(function(){var e=document.getElementsByTagName('script');return e[e.length-1]})();if(!s)return;var d=s.getAttribute('data-site-id');if(!d)return;var ep='';if(s.src){try{var u=new URL(s.src);ep=u.origin+'/api/tracking/events'}catch(e){}}if(!ep)ep='/api/tracking/events';function gId(){return 'evt_'+Math.random().toString(36).substring(2,10)+Date.now().toString(36)}function send(ev,pId){var p={siteId:d,eventName:ev,eventId:gId()};if(pId)p.productId=String(pId).trim();var j=JSON.stringify(p);if(navigator.sendBeacon){try{var b=new Blob([j],{type:'application/json'});if(navigator.sendBeacon(ep,b))return}catch(e){}}try{fetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:j,keepalive:true,mode:'cors',credentials:'omit'}).catch(function(){})}catch(e){}}send('page_view');document.addEventListener('click',function(e){try{var t=e.target;while(t&&t!==document){if(t.hasAttribute&&t.hasAttribute('data-track-product-id')){var p=t.getAttribute('data-track-product-id');if(p){send('product_click',p)}break}t=t.parentElement}}catch(err){}},{capture:true,passive:true})}catch(err){}})();`;
  }
}
