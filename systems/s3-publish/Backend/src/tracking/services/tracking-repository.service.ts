import { getDbPool } from '../../db';
import {
  ProductRecord,
  CampaignRecord,
  TrackedLinkRecord,
  TrackedClickRecord,
  TrackingStatsProductItem,
  TrackingStatsCampaignItem,
  TrackingStatsLinkItem,
  TrackingWebsiteRecord,
  TrackingWebsiteEventRecord,
} from '../types/tracking.types';

export class TrackingRepositoryService {
  private memoryProducts: Map<string, ProductRecord> = new Map();
  private memoryCampaigns: Map<string, CampaignRecord> = new Map();
  private memoryLinks: Map<string, TrackedLinkRecord> = new Map();
  private memorySlugToId: Map<string, string> = new Map();
  private memoryClicks: TrackedClickRecord[] = [];

  // Phase 2 memory stores
  private memoryWebsites: Map<string, TrackingWebsiteRecord> = new Map();
  private memorySiteIdToWebId: Map<string, string> = new Map();
  private memoryWebsiteEvents: TrackingWebsiteEventRecord[] = [];
  private memoryEventIdMap: Set<string> = new Set(); // websiteId:eventId for idempotency

  // --- Products ---

  async createProduct(product: ProductRecord): Promise<ProductRecord> {
    this.memoryProducts.set(product.id, { ...product });

    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO products (id, user_id, name, destination_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            product.id,
            product.userId,
            product.name,
            product.destinationUrl,
            product.createdAt,
            product.updatedAt,
          ]
        );
      } catch (err: any) {
        // Fallback gracefully to memory if table does not yet exist
        console.warn('[TrackingRepository] DB insert product fallback to memory:', err.message);
      }
    }

    return { ...product };
  }

  async findProductsByUserId(userId: string): Promise<ProductRecord[]> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id AS "userId", name, destination_url AS "destinationUrl",
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM products
           WHERE user_id = $1
           ORDER BY created_at DESC`,
          [userId]
        );
        if (res.rows && res.rows.length > 0) {
          return res.rows;
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB find products fallback to memory:', err.message);
      }
    }

    return Array.from(this.memoryProducts.values())
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findProductById(productId: string, userId: string): Promise<ProductRecord | null> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id AS "userId", name, destination_url AS "destinationUrl",
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM products
           WHERE id = $1 AND user_id = $2`,
          [productId, userId]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB find product by id fallback to memory:', err.message);
      }
    }

    const prod = this.memoryProducts.get(productId);
    if (prod && prod.userId === userId) {
      return { ...prod };
    }
    return null;
  }

  // --- Campaigns ---

  async createCampaign(campaign: CampaignRecord): Promise<CampaignRecord> {
    this.memoryCampaigns.set(campaign.id, { ...campaign });

    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO campaigns (id, user_id, product_id, name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            campaign.id,
            campaign.userId,
            campaign.productId,
            campaign.name,
            campaign.createdAt,
            campaign.updatedAt,
          ]
        );
      } catch (err: any) {
        console.warn('[TrackingRepository] DB insert campaign fallback to memory:', err.message);
      }
    }

    return { ...campaign };
  }

  async findCampaignsByUserId(userId: string, productId?: string): Promise<CampaignRecord[]> {
    const pool = getDbPool();
    if (pool) {
      try {
        let query = `
          SELECT id, user_id AS "userId", product_id AS "productId", name,
                 created_at AS "createdAt", updated_at AS "updatedAt"
          FROM campaigns
          WHERE user_id = $1
        `;
        const params: any[] = [userId];
        if (productId) {
          query += ` AND product_id = $2`;
          params.push(productId);
        }
        query += ` ORDER BY created_at DESC`;
        const res = await pool.query(query, params);
        if (res.rows && res.rows.length > 0) {
          return res.rows;
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB find campaigns fallback to memory:', err.message);
      }
    }

    return Array.from(this.memoryCampaigns.values())
      .filter((c) => c.userId === userId && (!productId || c.productId === productId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findCampaignById(campaignId: string, userId: string): Promise<CampaignRecord | null> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id AS "userId", product_id AS "productId", name,
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM campaigns
           WHERE id = $1 AND user_id = $2`,
          [campaignId, userId]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB find campaign by id fallback to memory:', err.message);
      }
    }

    const camp = this.memoryCampaigns.get(campaignId);
    if (camp && camp.userId === userId) {
      return { ...camp };
    }
    return null;
  }

  // --- Tracked Links ---

  async createTrackedLink(link: TrackedLinkRecord): Promise<TrackedLinkRecord> {
    this.memoryLinks.set(link.id, { ...link });
    this.memorySlugToId.set(link.slug, link.id);

    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO tracked_links (id, user_id, campaign_id, product_id, slug, destination_url, label, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            link.id,
            link.userId,
            link.campaignId,
            link.productId,
            link.slug,
            link.destinationUrl,
            link.label || null,
            link.createdAt,
            link.updatedAt,
          ]
        );
      } catch (err: any) {
        console.warn('[TrackingRepository] DB insert link fallback to memory:', err.message);
      }
    }

    return { ...link };
  }

  async findTrackedLinksByUserId(userId: string, campaignId?: string): Promise<TrackedLinkRecord[]> {
    const pool = getDbPool();
    if (pool) {
      try {
        let query = `
          SELECT id, user_id AS "userId", campaign_id AS "campaignId", product_id AS "productId",
                 slug, destination_url AS "destinationUrl", label,
                 created_at AS "createdAt", updated_at AS "updatedAt"
          FROM tracked_links
          WHERE user_id = $1
        `;
        const params: any[] = [userId];
        if (campaignId) {
          query += ` AND campaign_id = $2`;
          params.push(campaignId);
        }
        query += ` ORDER BY created_at DESC`;
        const res = await pool.query(query, params);
        if (res.rows && res.rows.length > 0) {
          return res.rows;
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB find links fallback to memory:', err.message);
      }
    }

    return Array.from(this.memoryLinks.values())
      .filter((l) => l.userId === userId && (!campaignId || l.campaignId === campaignId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findTrackedLinkBySlug(slug: string): Promise<TrackedLinkRecord | null> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id AS "userId", campaign_id AS "campaignId", product_id AS "productId",
                  slug, destination_url AS "destinationUrl", label,
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM tracked_links
           WHERE slug = $1`,
          [slug]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB find link by slug fallback to memory:', err.message);
      }
    }

    const id = this.memorySlugToId.get(slug);
    if (id) {
      const link = this.memoryLinks.get(id);
      if (link) return { ...link };
    }
    return null;
  }

  // --- Clicks ---

  async recordClick(click: TrackedClickRecord): Promise<void> {
    this.memoryClicks.push({ ...click });

    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO tracked_link_clicks (id, link_id, campaign_id, product_id, user_id, is_bot, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            click.id,
            click.linkId,
            click.campaignId,
            click.productId,
            click.userId,
            click.isBot,
            click.createdAt,
          ]
        );
      } catch (err: any) {
        console.warn('[TrackingRepository] DB record click fallback to memory:', err.message);
      }
    }
  }

  // --- Aggregated Stats Scoped Strictly to User ---

  async getHierarchicalStats(
    userId: string,
    buildTrackedUrlFn: (slug: string) => string
  ): Promise<{ products: TrackingStatsProductItem[]; totalEligibleClicks: number }> {
    const products = await this.findProductsByUserId(userId);
    const campaigns = await this.findCampaignsByUserId(userId);
    const links = await this.findTrackedLinksByUserId(userId);

    // Get click counts per link
    const eligibleClicksByLink = new Map<string, number>();

    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT link_id, COUNT(*) AS count
           FROM tracked_link_clicks
           WHERE user_id = $1 AND is_bot = FALSE
           GROUP BY link_id`,
          [userId]
        );
        for (const row of res.rows) {
          eligibleClicksByLink.set(row.link_id, parseInt(row.count, 10) || 0);
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB count clicks fallback to memory:', err.message);
      }
    }

    // Fallback or augment with memory clicks if empty
    if (eligibleClicksByLink.size === 0) {
      for (const click of this.memoryClicks) {
        if (click.userId === userId && !click.isBot) {
          eligibleClicksByLink.set(
            click.linkId,
            (eligibleClicksByLink.get(click.linkId) || 0) + 1
          );
        }
      }
    }

    let totalEligibleClicks = 0;

    const productsResult: TrackingStatsProductItem[] = products.map((prod) => {
      const prodCampaigns = campaigns.filter((c) => c.productId === prod.id);
      let prodClicks = 0;

      const campaignItems: TrackingStatsCampaignItem[] = prodCampaigns.map((camp) => {
        const campLinks = links.filter((l) => l.campaignId === camp.id);
        let campClicks = 0;

        const linkItems: TrackingStatsLinkItem[] = campLinks.map((link) => {
          const clicks = eligibleClicksByLink.get(link.id) || 0;
          campClicks += clicks;
          return {
            id: link.id,
            slug: link.slug,
            trackedUrl: buildTrackedUrlFn(link.slug),
            label: link.label,
            destinationUrl: link.destinationUrl,
            eligibleClicks: clicks,
            createdAt: link.createdAt,
          };
        });

        prodClicks += campClicks;
        return {
          id: camp.id,
          name: camp.name,
          eligibleClicks: campClicks,
          links: linkItems,
        };
      });

      totalEligibleClicks += prodClicks;
      return {
        id: prod.id,
        name: prod.name,
        destinationUrl: prod.destinationUrl,
        eligibleClicks: prodClicks,
        campaigns: campaignItems,
      };
    });

    return {
      products: productsResult,
      totalEligibleClicks,
    };
  }

  // ==========================================
  // Phase 2: Connect Website & Activity Tracking
  // ==========================================

  async createWebsite(website: TrackingWebsiteRecord): Promise<TrackingWebsiteRecord> {
    this.memoryWebsites.set(website.id, { ...website });
    this.memorySiteIdToWebId.set(website.siteId, website.id);

    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          `INSERT INTO tracking_websites (id, user_id, site_id, name, origin, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            website.id,
            website.userId,
            website.siteId,
            website.name,
            website.origin,
            website.createdAt,
            website.updatedAt,
          ]
        );
      } catch (err: any) {
        console.warn('[TrackingRepository] DB insert website fallback to memory:', err.message);
      }
    }

    return { ...website };
  }

  async findWebsitesByUserId(userId: string): Promise<TrackingWebsiteRecord[]> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id AS "userId", site_id AS "siteId", name, origin,
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM tracking_websites
           WHERE user_id = $1
           ORDER BY created_at DESC`,
          [userId]
        );
        if (res.rows && res.rows.length > 0) {
          return res.rows;
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB find websites fallback to memory:', err.message);
      }
    }

    return Array.from(this.memoryWebsites.values())
      .filter((w) => w.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findWebsiteById(websiteId: string, userId: string): Promise<TrackingWebsiteRecord | null> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id AS "userId", site_id AS "siteId", name, origin,
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM tracking_websites
           WHERE id = $1 AND user_id = $2`,
          [websiteId, userId]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB find website by id fallback to memory:', err.message);
      }
    }

    const site = this.memoryWebsites.get(websiteId);
    if (site && site.userId === userId) {
      return { ...site };
    }
    return null;
  }

  async findWebsiteBySiteId(siteId: string): Promise<TrackingWebsiteRecord | null> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, user_id AS "userId", site_id AS "siteId", name, origin,
                  created_at AS "createdAt", updated_at AS "updatedAt"
           FROM tracking_websites
           WHERE site_id = $1`,
          [siteId]
        );
        if (res.rows.length > 0) {
          return res.rows[0];
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB find website by siteId fallback to memory:', err.message);
      }
    }

    const id = this.memorySiteIdToWebId.get(siteId);
    if (id) {
      const site = this.memoryWebsites.get(id);
      if (site) return { ...site };
    }
    return null;
  }

  async recordWebsiteEvent(event: TrackingWebsiteEventRecord): Promise<{ inserted: boolean }> {
    const dedupeKey = `${event.websiteId}:${event.eventId}`;

    // Memory idempotency check
    if (this.memoryEventIdMap.has(dedupeKey)) {
      return { inserted: false };
    }
    this.memoryEventIdMap.add(dedupeKey);
    this.memoryWebsiteEvents.push({ ...event });

    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `INSERT INTO tracking_website_events (id, website_id, user_id, event_name, event_id, product_id, is_bot, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (website_id, event_id) DO NOTHING`,
          [
            event.id,
            event.websiteId,
            event.userId,
            event.eventName,
            event.eventId,
            event.productId || null,
            event.isBot,
            event.createdAt,
          ]
        );
        if (res.rowCount === 0) {
          return { inserted: false };
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB record website event fallback to memory:', err.message);
      }
    }

    return { inserted: true };
  }

  async getWebsiteActivityStats(
    userId: string,
    websiteId?: string
  ): Promise<{
    website: TrackingWebsiteRecord | null;
    totalPageViews: number;
    totalProductClicks: number;
    productClickCounts: Map<string, number>;
  }> {
    const websites = await this.findWebsitesByUserId(userId);
    const activeWebsite = websiteId
      ? websites.find((w) => w.id === websiteId) || null
      : websites[0] || null;

    if (!activeWebsite) {
      return {
        website: null,
        totalPageViews: 0,
        totalProductClicks: 0,
        productClickCounts: new Map(),
      };
    }

    let totalPageViews = 0;
    let totalProductClicks = 0;
    const productClickCounts = new Map<string, number>();

    const pool = getDbPool();
    if (pool) {
      try {
        const viewsRes = await pool.query(
          `SELECT COUNT(*) AS count
           FROM tracking_website_events
           WHERE user_id = $1 AND website_id = $2 AND event_name = 'page_view' AND is_bot = FALSE`,
          [userId, activeWebsite.id]
        );
        totalPageViews = parseInt(viewsRes.rows[0]?.count, 10) || 0;

        const clicksRes = await pool.query(
          `SELECT product_id, COUNT(*) AS count
           FROM tracking_website_events
           WHERE user_id = $1 AND website_id = $2 AND event_name = 'product_click' AND is_bot = FALSE
           GROUP BY product_id`,
          [userId, activeWebsite.id]
        );

        for (const row of clicksRes.rows) {
          const count = parseInt(row.count, 10) || 0;
          totalProductClicks += count;
          if (row.product_id) {
            productClickCounts.set(row.product_id, count);
          }
        }
      } catch (err: any) {
        console.warn('[TrackingRepository] DB get website activity stats fallback to memory:', err.message);
      }
    }

    // Memory aggregation fallback/augmentation
    if (totalPageViews === 0 && totalProductClicks === 0) {
      for (const ev of this.memoryWebsiteEvents) {
        if (ev.userId === userId && ev.websiteId === activeWebsite.id && !ev.isBot) {
          if (ev.eventName === 'page_view') {
            totalPageViews++;
          } else if (ev.eventName === 'product_click') {
            totalProductClicks++;
            if (ev.productId) {
              productClickCounts.set(
                ev.productId,
                (productClickCounts.get(ev.productId) || 0) + 1
              );
            }
          }
        }
      }
    }

    return {
      website: activeWebsite,
      totalPageViews,
      totalProductClicks,
      productClickCounts,
    };
  }
}
