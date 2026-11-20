import { Router, Request, Response } from 'express';
import { SocialController } from '../social/controllers/social.controller';
import { AnalyticsController } from '../social/controllers/analytics.controller';
import { PublisherService } from '../social/services/publisher.service';
import { PostRepositoryService } from '../social/services/post-repository.service';
import { AnalyticsService } from '../social/services/analytics.service';
import { SocialConnectService } from '../social/services/social-connect.service';
import { CommentService } from '../social/services/comment.service';
import { UserRepository } from '../auth/user.repository';
import { PlatformRouter } from '../social/router/platform.router';
import { ZernioPublisher } from '../social/providers/zernio/zernio.publisher';
import { ZernioClient } from '../social/providers/zernio/zernio.client';
import { ZernioAnalyticsProvider } from '../social/providers/zernio/zernio.analytics';
import { AnalyticsRepositoryService } from '../social/services/analytics-repository.service';
import { requireAuth, requireOwner } from '../auth/auth.middleware';

export function createSocialRouter(
  customPublisherService?: PublisherService,
  customPostRepository?: PostRepositoryService,
  customAnalyticsService?: AnalyticsService,
  customSocialConnectService?: SocialConnectService,
  customCommentService?: CommentService
): Router {
  const router = Router();

  const postRepository = customPostRepository || new PostRepositoryService();
  const platformRouter = new PlatformRouter();
  const zernioClient = new ZernioClient();
  const zernioPublisher = new ZernioPublisher(zernioClient, platformRouter);

  const publisherService =
    customPublisherService || new PublisherService(platformRouter, zernioPublisher, postRepository);

  const zernioAnalyticsProvider = new ZernioAnalyticsProvider(zernioClient);
  const analyticsRepository = new AnalyticsRepositoryService();
  const analyticsService =
    customAnalyticsService ||
    new AnalyticsService(zernioAnalyticsProvider, analyticsRepository, postRepository);

  const userRepository = new UserRepository();
  const socialConnectService =
    customSocialConnectService ||
    new SocialConnectService(zernioClient, postRepository, userRepository);

  const commentService =
    customCommentService ||
    new CommentService(zernioClient, postRepository);

  const controller = new SocialController(
    publisherService,
    postRepository,
    socialConnectService,
    commentService
  );
  const analyticsController = new AnalyticsController(analyticsService, postRepository);

  router.post('/publish', requireAuth, controller.publish);
  router.get('/posts', requireAuth, controller.getPosts);
  router.get('/posts/:id', requireAuth, controller.getPostById);
  router.get('/posts/:id/comments', requireAuth, controller.getPostComments);
  router.get('/posts/:id/reactions', requireAuth, controller.getPostReactions);
  router.get('/accounts', requireAuth, controller.getAccounts);
  router.delete('/accounts/:accountId', requireAuth, controller.disconnectAccount);

  // Social account connection endpoints (hosted Zernio OAuth)
  router.get('/connect/:platform', requireAuth, controller.startConnect);
  router.post('/connect/callback', requireAuth, controller.completeConnect);
  router.get('/connect/callback', requireAuth, controller.completeConnect);

  // Connection verification endpoint (authenticated; sanitized for all roles)
  router.get('/auth/verify', requireAuth, async (req: Request, res: Response) => {
    const result = await zernioClient.verifyAuth();
    res.json({
      valid: Boolean(result?.valid),
      message: result?.valid ? 'Zernio engine ready' : 'Zernio engine unavailable',
    });
  });

  // Analytics endpoints
  router.get('/analytics/overview', requireAuth, analyticsController.getOverview);
  router.get('/analytics/:postId', requireAuth, analyticsController.getPostAnalytics);
  router.get('/analytics/:postId/timeline', requireAuth, analyticsController.getPostTimeline);

  return router;
}
