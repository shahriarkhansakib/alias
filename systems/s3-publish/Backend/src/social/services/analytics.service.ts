import {
  SocialAnalyticsProvider,
  AnalyticsOverviewFilter,
  NormalizedPostAnalytics,
  NormalizedPlatformMetric,
  EngagementActivityItem,
  NormalizedPostMetrics,
  NormalizedAnalyticsOverview,
} from '../types/analytics.types';
import { calculateEngagementRate } from '../providers/zernio/zernio.analytics';

import { AnalyticsRepositoryService } from './analytics-repository.service';
import { PostRepositoryService } from './post-repository.service';
import { SocialPublishingError } from '../types/publisher.types';
import { getDbPool } from '../../db';
import { v4 as uuidv4 } from 'uuid';

export class AnalyticsService {
  private analyticsProvider: SocialAnalyticsProvider;
  private analyticsRepository: AnalyticsRepositoryService;
  private postRepository: PostRepositoryService;

  constructor(
    analyticsProvider: SocialAnalyticsProvider,
    analyticsRepository?: AnalyticsRepositoryService,
    postRepository?: PostRepositoryService
  ) {
    this.analyticsProvider = analyticsProvider;
    this.analyticsRepository =
      analyticsRepository ||
      new AnalyticsRepositoryService();

    this.postRepository =
      postRepository ||
      new PostRepositoryService();
  }

  public async getPostAnalytics(
    postId: string,
    forceRefresh: boolean = false,
    userId?: string
  ): Promise<any> {
    if (!forceRefresh) {
      const cached =
        this.analyticsRepository.getPostAnalytics(
          postId
        );

      if (cached) {
        if (userId) {
          const post = await this.postRepository.findById(postId, userId);
          if (!post) {
            throw new SocialPublishingError(
              `Post analytics not found for ID: ${postId}`,
              404
            );
          }
        }
        return cached;
      }
    }

    try {
      /*
       * Get local post first.
       *
       * This is important because the requested ID may be
       * our internal post ID while Zernio uses another ID.
       */
      const localPost =
        await this.postRepository.findById(
          postId,
          userId
        );

      /*
       * Build every possible identifier we know about
       * this post.
       */
      const candidateIds: string[] = [];

      const addCandidate = (
        value: unknown
      ): void => {
        if (
          value === undefined ||
          value === null
        ) {
          return;
        }

        const valueString =
          String(value).trim();

        if (
          valueString &&
          !candidateIds.includes(valueString)
        ) {
          candidateIds.push(valueString);
        }
      };

      /*
       * Try repository DB mapping.
       */
      const resolvedZernioPostId =
        await this.postRepository.resolveZernioPostId(
          postId,
          userId
        );

      addCandidate(
        resolvedZernioPostId
      );

      addCandidate(postId);

      /*
       * If local post exists, add provider and
       * platform-specific IDs.
       */
      if (localPost) {
        addCandidate(
          localPost.providerPostId
        );

        if (
          Array.isArray(
            localPost.platforms
          )
        ) {
          for (const platform of localPost.platforms) {
            addCandidate(
              platform.platformPostId
            );
            addCandidate(
              (platform as any).zernioPostId
            );

            // Handle composite Facebook IDs like "pageId_postId"
            if (platform.platformPostId && platform.platformPostId.includes('_')) {
              const parts = platform.platformPostId.split('_');
              addCandidate(parts[parts.length - 1]);
            }
          }
        }
      }

      console.log(
        '[AnalyticsService] POST ANALYTICS CANDIDATE IDS:',
        candidateIds
      );

      let analytics:
        | NormalizedPostAnalytics
        | null = null;

      /*
       * Try every known ID until Zernio returns
       * a matching analytics record.
       */
      for (const candidateId of candidateIds) {
        try {
          console.log(
            '[AnalyticsService] TRYING ZERNIO ANALYTICS ID:',
            candidateId
          );

          analytics =
            await this.analyticsProvider.getPostAnalytics(
              candidateId
            );

          if (analytics) {
            console.log(
              '[AnalyticsService] ANALYTICS FOUND USING ID:',
              candidateId
            );

            break;
          }
        } catch (error) {
          console.warn(
            '[AnalyticsService] ANALYTICS ATTEMPT FAILED:',
            candidateId,
            error instanceof Error
              ? error.message
              : error
          );
        }
      }

      if (analytics) {
        /*
         * Always expose our application's internal
         * post ID to the frontend.
         */

        // Merge local post platform data into platformBreakdown.
        // The provider may have only produced an entry for the detected
        // platform; here we ensure every platform the local post targets
        // is at least represented with a 'published' entry.
        const ALL_KNOWN_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'linkedin'];
        const zeroMetrics: NormalizedPostMetrics = {
          impressions: 0, reach: 0, likes: 0, comments: 0,
          shares: 0, saves: 0, clicks: 0, views: 0, engagementRate: 0,
        };

        let enrichedPlatformBreakdown: NormalizedPlatformMetric[] =
          Array.isArray(analytics.platformBreakdown)
            ? [...analytics.platformBreakdown]
            : ALL_KNOWN_PLATFORMS.map((pl) => ({
              platform: pl,
              status: 'not_targeted' as const,
              metrics: zeroMetrics,
            }));

        if (localPost && Array.isArray(localPost.platforms)) {
          for (const lp of localPost.platforms) {
            const lpPlatform = (lp.platform || '').toLowerCase();
            const existing = enrichedPlatformBreakdown.find(
              (b) => b.platform.toLowerCase() === lpPlatform
            );
            if (existing && existing.status === 'not_targeted') {
              // Local post says this platform IS targeted — upgrade from not_targeted.
              existing.status = 'published';
              existing.platformPostId = existing.platformPostId || lp.platformPostId;
              existing.platformPostUrl = existing.platformPostUrl || lp.platformPostUrl;
              if (localPost.platforms.length === 1 && analytics.metrics) {
                existing.metrics = analytics.metrics;
              }
            } else if (!existing && lpPlatform) {
              // Platform not in the standard 6 — add it.
              enrichedPlatformBreakdown.push({
                platform: lpPlatform,
                status: 'published',
                platformPostId: lp.platformPostId,
                platformPostUrl: lp.platformPostUrl,
                metrics: zeroMetrics,
              });
            }
          }
        }

        // Preserve genuine provider-supplied engagementActivity items if present.
        // Do NOT synthesize fake event rows, actors, or timestamps from daily timeline deltas.
        const engagementActivity: EngagementActivityItem[] =
          Array.isArray(analytics.engagementActivity)
            ? analytics.engagementActivity
            : [];

        const responseData: NormalizedPostAnalytics = {
          ...analytics,
          postId,
          platformBreakdown: enrichedPlatformBreakdown,
          engagementActivity,
        };

        this.analyticsRepository.setPostAnalytics(
          postId,
          responseData
        );

        /*
         * Persist using the Zernio ID that actually
         * matched, if possible.
         */
        const matchedZernioId =
          candidateIds.find(
            (candidateId) =>
              candidateId !== postId
          ) ||
          resolvedZernioPostId ||
          postId;

        await this.persistAnalyticsSnapshot(
          postId,
          matchedZernioId,
          responseData
        );

        return responseData;
      }

      if (localPost) {
        return {
          postId,

          platform:
            localPost.platforms?.[0]
              ?.platform ||
            'facebook',

          status: 'no_data_yet',

          message:
            'Post exists, but analytics data is not available from Zernio yet.',

          metrics: {
            impressions: 0,
            reach: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            saves: 0,
            clicks: 0,
            views: 0,
            engagementRate: 0,
          },

          reactionBreakdown: null,

          timeline: [],

          fetchedAt:
            new Date().toISOString(),
        };
      }

      throw new SocialPublishingError(
        `Post analytics not found for ID: ${postId}`,
        404
      );
    } catch (error: any) {
      if (
        error instanceof SocialPublishingError
      ) {
        throw error;
      }

      throw new SocialPublishingError(
        `Failed to fetch analytics for post ${postId}: ${error?.message || 'Unknown error'
        }`,
        500
      );
    }
  }

  public async getPostTimeline(
    postId: string,
    forceRefresh: boolean = false,
    userId?: string
  ): Promise<any> {
    if (!forceRefresh) {
      const cached =
        this.analyticsRepository.getTimeline(
          postId
        );

      if (cached) {
        if (userId) {
          const post = await this.postRepository.findById(postId, userId);
          if (!post) {
            throw new SocialPublishingError(
              `Post timeline not found for ID: ${postId}`,
              404
            );
          }
        }
        return {
          postId,
          timeline: cached,
        };
      }
    }

    const localPost =
      await this.postRepository.findById(
        postId,
        userId
      );

    if (userId && !localPost) {
      throw new SocialPublishingError(
        `Post timeline not found for ID: ${postId}`,
        404
      );
    }

    const candidateIds: string[] = [];

    const addCandidate = (
      value: unknown
    ): void => {
      if (
        value === undefined ||
        value === null
      ) {
        return;
      }

      const valueString =
        String(value).trim();

      if (
        valueString &&
        !candidateIds.includes(valueString)
      ) {
        candidateIds.push(valueString);
      }
    };

    const resolvedZernioPostId =
      await this.postRepository.resolveZernioPostId(
        postId,
        userId
      );

    addCandidate(
      resolvedZernioPostId
    );

    addCandidate(postId);

    if (localPost) {
      addCandidate(
        localPost.providerPostId
      );

      if (
        Array.isArray(
          localPost.platforms
        )
      ) {
        for (const platform of localPost.platforms) {
          addCandidate(
            platform.platformPostId
          );
        }
      }
    }

    let timeline: any[] = [];

    for (const candidateId of candidateIds) {
      try {
        console.log(
          '[AnalyticsService] TRYING TIMELINE ID:',
          candidateId
        );

        const result =
          await this.analyticsProvider.getPostTimeline(
            candidateId
          );

        if (
          Array.isArray(result) &&
          result.length > 0
        ) {
          timeline = result;
          break;
        }
      } catch (error) {
        console.warn(
          '[AnalyticsService] TIMELINE ATTEMPT FAILED:',
          candidateId,
          error instanceof Error
            ? error.message
            : error
        );
      }
    }

    if (timeline.length > 0) {
      this.analyticsRepository.setTimeline(
        postId,
        timeline
      );
    }

    return {
      postId,
      timeline,
    };
  }

  public async getOverview(
    filter?: AnalyticsOverviewFilter,
    forceRefresh: boolean = false,
    userId?: string
  ): Promise<{ success: boolean; overview: NormalizedAnalyticsOverview }> {
    if (!userId) {
      throw new SocialPublishingError('Authentication required for analytics overview.', 401);
    }

    // 1. Load ONLY the authenticated user's posts from the user-scoped repository
    const userPosts = await this.postRepository.listAll(userId);

    // 2. Filter for published posts owned by this user
    // Include posts confirmed published or legacy scheduled posts whose scheduled time has passed and have provider IDs
    let publishedPosts = userPosts.filter((p) => {
      if (p.status === 'published') return true;
      if (Array.isArray(p.platforms) && p.platforms.some((pl) => pl.status === 'published' || pl.platformPostId)) return true;
      if (
        p.status === 'scheduled' &&
        (p.providerPostId || p.platforms?.some((pl: any) => pl.zernioPostId || pl.platformPostId)) &&
        p.scheduledFor &&
        new Date(p.scheduledFor).getTime() <= Date.now()
      ) {
        return true;
      }
      return false;
    });

    // 3. Apply optional platform filter
    if (filter?.platform) {
      const targetPlatform = filter.platform.toLowerCase();
      publishedPosts = publishedPosts.filter(
        (p) =>
          Array.isArray(p.platforms) &&
          p.platforms.some((pl) => (pl.platform || '').toLowerCase() === targetPlatform)
      );
    }

    // 4. Apply optional date filters (by post creation date)
    if (filter?.fromDate) {
      const fromTime = new Date(filter.fromDate).getTime();
      if (!isNaN(fromTime)) {
        publishedPosts = publishedPosts.filter(
          (p) => new Date(p.createdAt).getTime() >= fromTime
        );
      }
    }
    if (filter?.toDate) {
      const toTime = new Date(filter.toDate).getTime();
      if (!isNaN(toTime)) {
        publishedPosts = publishedPosts.filter(
          (p) => new Date(p.createdAt).getTime() <= toTime
        );
      }
    }

    // 5. Aggregate per-post metrics for these exact owned published posts
    let totalImpressions = 0;
    let totalReach = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalShares = 0;
    let totalClicks = 0;
    let totalViews = 0;

    for (const post of publishedPosts) {
      try {
        const postAnalytics = await this.getPostAnalytics(post.internalPostId, forceRefresh, userId);
        if (postAnalytics?.metrics) {
          let m = postAnalytics.metrics;
          if (filter?.platform && postAnalytics.platformBreakdown?.length) {
            const pb = postAnalytics.platformBreakdown.find(
              (p: NormalizedPlatformMetric) =>
                p.platform.toLowerCase() === filter.platform!.toLowerCase()
            );
            if (
              pb &&
              pb.metrics &&
              (pb.metrics.impressions > 0 ||
                pb.metrics.reach > 0 ||
                pb.metrics.likes > 0 ||
                pb.metrics.clicks > 0)
            ) {
              m = pb.metrics;
            }
          }

          totalImpressions += Number(m.impressions) || 0;
          totalReach += Number(m.reach) || 0;
          totalLikes += Number(m.likes) || 0;
          totalComments += Number(m.comments) || 0;
          totalShares += Number(m.shares) || 0;
          totalClicks += Number(m.clicks) || 0;
          totalViews += Number(m.views) || 0;
        }
      } catch (err) {
        console.warn(
          `[AnalyticsService] Failed to load metrics for user post ${post.internalPostId}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    // 6. Calculate pooled engagement rate across these owned posts
    const pooledEngagementRate = calculateEngagementRate({
      impressions: totalImpressions,
      reach: totalReach,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
      clicks: totalClicks,
      views: totalViews,
    });

    const overview: NormalizedAnalyticsOverview = {
      totalPosts: publishedPosts.length,
      impressions: totalImpressions,
      reach: totalReach,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
      clicks: totalClicks,
      views: totalViews,
      engagementRate: pooledEngagementRate,
    };

    return {
      success: true,
      overview,
    };
  }

  private async persistAnalyticsSnapshot(
    internalPostId: string,
    zernioPostId: string,
    analytics: NormalizedPostAnalytics
  ): Promise<void> {
    const pool = getDbPool();

    if (!pool) {
      return;
    }

    try {
      const pfRes =
        await pool.query(
          `SELECT id
           FROM post_platforms
           WHERE post_id = $1
              OR zernio_post_id = $2
              OR platform_post_id = $2
           LIMIT 1`,
          [
            internalPostId,
            zernioPostId,
          ]
        );

      if (
        pfRes.rows.length === 0
      ) {
        return;
      }

      const postPlatformId =
        pfRes.rows[0].id;

      const snapshotId =
        `snap_${uuidv4()}`;

      const m =
        analytics.metrics;

      await pool.query(
        `INSERT INTO analytics_snapshots
         (
           id,
           post_platform_id,
           impressions,
           reach,
           likes,
           comments,
           shares,
           saves,
           clicks,
           views,
           engagement_rate,
           fetched_at
         )
         VALUES
         (
           $1,
           $2,
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           $11,
           $12
         )`,
        [
          snapshotId,
          postPlatformId,
          m.impressions,
          m.reach,
          m.likes,
          m.comments,
          m.shares,
          m.saves,
          m.clicks,
          m.views,
          m.engagementRate,
          new Date(),
        ]
      );

      if (
        analytics.timeline &&
        analytics.timeline.length > 0
      ) {
        for (const pt of analytics.timeline) {
          const timelineId =
            `tl_${uuidv4()}`;

          await pool.query(
            `INSERT INTO analytics_timeline
             (
               id,
               post_platform_id,
               date,
               impressions,
               reach,
               likes,
               comments,
               shares,
               saves,
               clicks,
               views,
               engagement_rate
             )
             VALUES
             (
               $1,
               $2,
               $3,
               $4,
               $5,
               $6,
               $7,
               $8,
               $9,
               $10,
               $11,
               $12
             )
             ON CONFLICT DO NOTHING`,
            [
              timelineId,
              postPlatformId,
              pt.date,
              pt.impressions,
              pt.reach,
              pt.likes,
              pt.comments,
              pt.shares,
              pt.saves,
              pt.clicks,
              pt.views,
              pt.engagementRate,
            ]
          );
        }
      }
      /*
       * Fix B — status sync:
       *
       * If Zernio returned real analytics (meaning the post is live),
       * but our local `posts` / `post_platforms` rows still say
       * "scheduled", upgrade them to "published" so that
       * GET /posts/:id reflects the real state.
       *
       * We only do this when analytics contain non-zero engagement
       * OR when the analytics object has a `publishedAt` field —
       * either is a reliable signal that the post went live.
       */
      const isConfirmedPublished =
        (analytics as any).publishedAt ||
        (m && (
          (m.impressions ?? 0) > 0 ||
          (m.reach ?? 0) > 0 ||
          (m.likes ?? 0) > 0 ||
          (m.comments ?? 0) > 0 ||
          (m.clicks ?? 0) > 0 ||
          (m.views ?? 0) > 0
        ));

      if (isConfirmedPublished) {
        /*
         * Retrieve the platform-level details Zernio confirmed
         * (platformPostId, platformPostUrl, publishedAt) from the
         * analytics breakdown so we can persist them.
         */
        const breakdown = Array.isArray(analytics.platformBreakdown)
          ? analytics.platformBreakdown
          : [];
        const publishedBreakdownEntry = breakdown.find(
          (b) => b.status === 'published' && b.platformPostId
        );

        const platformPostId = publishedBreakdownEntry?.platformPostId || null;
        const platformPostUrl = publishedBreakdownEntry?.platformPostUrl || null;
        const publishedAt = (analytics as any).publishedAt
          ? new Date((analytics as any).publishedAt)
          : new Date();

        /*
         * Update post_platforms row (if still "scheduled").
         */
        await pool.query(
          `UPDATE post_platforms
           SET
             status = 'published',
             platform_post_id = COALESCE($1, platform_post_id),
             platform_post_url = COALESCE($2, platform_post_url),
             published_at = COALESCE(published_at, $3)
           WHERE id = $4
             AND status = 'scheduled'`,
          [platformPostId, platformPostUrl, publishedAt, postPlatformId]
        );

        /*
         * Update the parent posts row (if still "scheduled").
         * We also set updated_at and published_at so the
         * frontend shows the real transition timestamp.
         */
        await pool.query(
          `UPDATE posts
           SET
             status = 'published',
             published_at = COALESCE(published_at, $1),
             updated_at = NOW()
           WHERE id = $2
             AND status = 'scheduled'`,
          [publishedAt, internalPostId]
        );

        console.log(
          '[AnalyticsService] Status sync: upgraded post',
          internalPostId,
          'and its platform row to "published".'
        );
      }
    } catch (err) {
      console.error(
        '[AnalyticsService] Error persisting analytics snapshot:',
        err
      );
    }
  }
}



// import { SocialAnalyticsProvider, AnalyticsOverviewFilter, NormalizedPostAnalytics } from '../types/analytics.types';
// import { AnalyticsRepositoryService } from './analytics-repository.service';
// import { PostRepositoryService } from './post-repository.service';
// import { SocialPublishingError } from '../types/publisher.types';
// import { getDbPool } from '../../db';
// import { v4 as uuidv4 } from 'uuid';

// export class AnalyticsService {
//   private analyticsProvider: SocialAnalyticsProvider;
//   private analyticsRepository: AnalyticsRepositoryService;
//   private postRepository: PostRepositoryService;

//   constructor(
//     analyticsProvider: SocialAnalyticsProvider,
//     analyticsRepository?: AnalyticsRepositoryService,
//     postRepository?: PostRepositoryService
//   ) {
//     this.analyticsProvider = analyticsProvider;
//     this.analyticsRepository = analyticsRepository || new AnalyticsRepositoryService();
//     this.postRepository = postRepository || new PostRepositoryService();
//   }

//   public async getPostAnalytics(postId: string): Promise<any> {
//     // Check in-memory/TTL cache first
//     const cached = this.analyticsRepository.getPostAnalytics(postId);
//     if (cached) {
//       return cached;
//     }

//     // Resolve internal postId -> zernioPostId using PostRepository mapping
//     const zernioPostId = await this.postRepository.resolveZernioPostId(postId);

//     try {
//       // Call Zernio provider with resolved Zernio post ID (or postId)
//       let analytics = await this.analyticsProvider.getPostAnalytics(zernioPostId);
//       if (!analytics && zernioPostId !== postId) {
//         // Fallback check with original postId if different
//         analytics = await this.analyticsProvider.getPostAnalytics(postId);
//       }

//       if (analytics) {
//         // Ensure returned analytics preserves requested internal postId or platformPostId
//         const responseData: NormalizedPostAnalytics = {
//           ...analytics,
//           postId: postId,
//         };

//         this.analyticsRepository.setPostAnalytics(postId, responseData);
//         await this.persistAnalyticsSnapshot(postId, zernioPostId, responseData);
//         return responseData;
//       }
//     } catch (error: any) {
//       if (error instanceof SocialPublishingError) {
//         throw error;
//       }
//       throw new SocialPublishingError(`Failed to fetch analytics for post ${postId}: ${error.message}`, 500);
//     }

//     // If analytics not found from upstream, check if post exists in local repository
//     const localPost = await this.postRepository.findById(postId);
//     if (localPost) {
//       return {
//         postId,
//         platform: localPost.platforms[0]?.platform || 'facebook',
//         status: 'no_data_yet',
//         message: 'Analytics data is being processed or not available yet.',
//         metrics: {
//           impressions: 0,
//           reach: 0,
//           likes: 0,
//           comments: 0,
//           shares: 0,
//           saves: 0,
//           clicks: 0,
//           views: 0,
//           engagementRate: 0,
//         },
//         reactionBreakdown: null,
//         timeline: [],
//         fetchedAt: new Date().toISOString(),
//       };
//     }

//     throw new SocialPublishingError(`Post analytics not found for ID: ${postId}`, 404);
//   }

//   public async getPostTimeline(postId: string): Promise<any> {
//     const cached = this.analyticsRepository.getTimeline(postId);
//     if (cached) {
//       return { postId, timeline: cached };
//     }

//     const zernioPostId = await this.postRepository.resolveZernioPostId(postId);

//     try {
//       let timeline = await this.analyticsProvider.getPostTimeline(zernioPostId);
//       if ((!timeline || timeline.length === 0) && zernioPostId !== postId) {
//         timeline = await this.analyticsProvider.getPostTimeline(postId);
//       }
//       this.analyticsRepository.setTimeline(postId, timeline);
//       return { postId, timeline };
//     } catch (error: any) {
//       if (error instanceof SocialPublishingError) {
//         throw error;
//       }
//       throw new SocialPublishingError(`Failed to fetch timeline for post ${postId}: ${error.message}`, 500);
//     }
//   }

//   public async getOverview(filter?: AnalyticsOverviewFilter): Promise<any> {
//     const filterKey = JSON.stringify(filter || {});
//     const cached = this.analyticsRepository.getOverview(filterKey);
//     if (cached) {
//       return { success: true, overview: cached };
//     }

//     try {
//       const overview = await this.analyticsProvider.getOverview(filter);
//       this.analyticsRepository.setOverview(filterKey, overview);
//       return { success: true, overview };
//     } catch (error: any) {
//       if (error instanceof SocialPublishingError) {
//         throw error;
//       }
//       throw new SocialPublishingError(`Failed to fetch analytics overview: ${error.message}`, 500);
//     }
//   }

//   private async persistAnalyticsSnapshot(internalPostId: string, zernioPostId: string, analytics: NormalizedPostAnalytics): Promise<void> {
//     const pool = getDbPool();
//     if (!pool) return;

//     try {
//       const pfRes = await pool.query(
//         `SELECT id FROM post_platforms 
//          WHERE post_id = $1 OR zernio_post_id = $2 OR platform_post_id = $2 
//          LIMIT 1`,
//         [internalPostId, zernioPostId]
//       );

//       if (pfRes.rows.length === 0) return;
//       const postPlatformId = pfRes.rows[0].id;

//       const snapshotId = `snap_${uuidv4()}`;
//       const m = analytics.metrics;

//       await pool.query(
//         `INSERT INTO analytics_snapshots 
//          (id, post_platform_id, impressions, reach, likes, comments, shares, saves, clicks, views, engagement_rate, fetched_at)
//          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
//         [
//           snapshotId,
//           postPlatformId,
//           m.impressions,
//           m.reach,
//           m.likes,
//           m.comments,
//           m.shares,
//           m.saves,
//           m.clicks,
//           m.views,
//           m.engagementRate,
//           new Date(),
//         ]
//       );

//       if (analytics.timeline && analytics.timeline.length > 0) {
//         for (const pt of analytics.timeline) {
//           const timelineId = `tl_${uuidv4()}`;
//           await pool.query(
//             `INSERT INTO analytics_timeline 
//              (id, post_platform_id, date, impressions, reach, likes, comments, shares, saves, clicks, views, engagement_rate)
//              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
//              ON CONFLICT DO NOTHING`,
//             [
//               timelineId,
//               postPlatformId,
//               pt.date,
//               pt.impressions,
//               pt.reach,
//               pt.likes,
//               pt.comments,
//               pt.shares,
//               pt.saves,
//               pt.clicks,
//               pt.views,
//               pt.engagementRate,
//             ]
//           );
//         }
//       }
//     } catch (err) {
//       console.error('[AnalyticsService] Error persisting analytics snapshot:', err);
//     }
//   }
// }
