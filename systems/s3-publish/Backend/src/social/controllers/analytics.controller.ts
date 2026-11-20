import { Request, Response } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { PostRepositoryService } from '../services/post-repository.service';
import { SocialPublishingError } from '../types/publisher.types';

export class AnalyticsController {
  private analyticsService: AnalyticsService;
  private postRepository: PostRepositoryService;

  constructor(analyticsService: AnalyticsService, postRepository?: PostRepositoryService) {
    this.analyticsService = analyticsService;
    this.postRepository =
      postRepository ||
      (analyticsService as any).postRepository ||
      new PostRepositoryService();
  }

  public getPostAnalytics = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const postId = String(req.params.postId);

      // Verify post ownership before fetching
      const post = await this.postRepository.findById(postId, userId);
      if (!post) {
        res.status(404).json({
          success: false,
          error: `Post with ID '${postId}' not found.`,
        });
        return;
      }

      const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
      const data = forceRefresh
        ? await this.analyticsService.getPostAnalytics(postId, true, userId)
        : await this.analyticsService.getPostAnalytics(postId, false, userId);
      res.status(200).json(data);
    } catch (error: any) {
      if (error instanceof SocialPublishingError) {
        res.status(error.statusCode).json({ success: false, error: error.message, details: error.details });
        return;
      }
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch post analytics' });
    }
  };

  public getPostTimeline = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const postId = String(req.params.postId);

      // Verify post ownership before fetching
      const post = await this.postRepository.findById(postId, userId);
      if (!post) {
        res.status(404).json({
          success: false,
          error: `Post with ID '${postId}' not found.`,
        });
        return;
      }

      const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
      const data = forceRefresh
        ? await this.analyticsService.getPostTimeline(postId, true, userId)
        : await this.analyticsService.getPostTimeline(postId, false, userId);
      res.status(200).json(data);
    } catch (error: any) {
      if (error instanceof SocialPublishingError) {
        res.status(error.statusCode).json({ success: false, error: error.message, details: error.details });
        return;
      }
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch post timeline' });
    }
  };

  public getOverview = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const { platform, fromDate, toDate } = req.query;
      const filter = {
        platform: platform ? String(platform) : undefined,
        fromDate: fromDate ? String(fromDate) : undefined,
        toDate: toDate ? String(toDate) : undefined,
      };

      const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
      const data = forceRefresh
        ? await this.analyticsService.getOverview(filter, true, userId)
        : await this.analyticsService.getOverview(filter, false, userId);
      res.status(200).json(data);
    } catch (error: any) {
      if (error instanceof SocialPublishingError) {
        res.status(error.statusCode).json({ success: false, error: error.message, details: error.details });
        return;
      }
      res.status(500).json({ success: false, error: error.message || 'Failed to fetch analytics overview' });
    }
  };
}
