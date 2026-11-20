import { Request, Response } from 'express';
import { PublisherService } from '../services/publisher.service';
import { PostRepositoryService } from '../services/post-repository.service';
import { SocialConnectService } from '../services/social-connect.service';
import { CommentService } from '../services/comment.service';
import { ZernioClient } from '../providers/zernio/zernio.client';
import { publishPostSchema } from '../validation/social.validation';
import { SocialPublishingError } from '../types/publisher.types';

export class SocialController {
  private publisherService: PublisherService;
  private postRepository: PostRepositoryService;
  private socialConnectService?: SocialConnectService;
  private commentService: CommentService;

  constructor(
    publisherService: PublisherService,
    postRepository: PostRepositoryService,
    socialConnectService?: SocialConnectService,
    commentService?: CommentService
  ) {
    this.publisherService = publisherService;
    this.postRepository = postRepository;
    this.socialConnectService = socialConnectService;
    this.commentService =
      commentService || new CommentService(new ZernioClient(), postRepository);
  }

  public publish = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      // Validate schema
      const parseResult = publishPostSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorMessages = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        res.status(400).json({
          success: false,
          error: `Validation error: ${errorMessages}`,
        });
        return;
      }

      const input: any = parseResult.data;

      // Verify the requested accountId belongs to this user in social_accounts
      for (const pl of input.platforms) {
        const isOwned = await this.postRepository.isAccountOwnedByUser(userId, pl.accountId);
        if (!isOwned) {
          res.status(403).json({
            success: false,
            error: `Forbidden: Social account '${pl.accountId}' does not belong to the current user.`,
          });
          return;
        }
      }

      // Normalize scheduled date fields
      const scheduledValue = input.scheduledFor || input.scheduledAt;
      if (scheduledValue) {
        input.scheduledFor = scheduledValue;
        input.scheduledAt = scheduledValue;
      } else if (input.publishNow === false) {
        res.status(400).json({
          success: false,
          error: 'Scheduled date and time (scheduledFor or scheduledAt) is required when publishNow is false.',
        });
        return;
      }

      // Remove empty imageUrl
      if (!input.imageUrl || (typeof input.imageUrl === 'string' && input.imageUrl.trim() === '')) {
        delete input.imageUrl;
      }

      // Also allow x-idempotency-key or x-request-id header if provided
      if (!input.idempotencyKey) {
        input.idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['x-request-id']) as string | undefined;
      }

      const result = await this.publisherService.publishPost(input, userId);
      
      const statusCode = (result.success || result.status === 'published' || result.status === 'scheduled')
        ? 200
        : result.status === 'partial'
          ? 207
          : 400;
      res.status(statusCode).json(result);
    } catch (err: any) {
      if (err instanceof SocialPublishingError) {
        res.status(err.statusCode).json({
          success: false,
          error: err.message,
          details: err.details,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: 'An unexpected internal error occurred while processing social publish request.',
      });
    }
  };

  public getPosts = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    const posts = await this.postRepository.listAll(userId);
    res.json({
      success: true,
      count: posts.length,
      posts,
    });
  };

  public getPostById = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const post = await this.postRepository.findById(id, userId);
    if (!post) {
      res.status(404).json({
        success: false,
        error: `Post with ID '${id}' not found.`,
      });
      return;
    }
    res.json({
      success: true,
      post,
    });
  };

  public getPostComments = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 25;

      const result = await this.commentService.getPostComments(
        id,
        userId,
        cursor,
        isNaN(limit) ? 25 : limit
      );
      res.status(200).json(result);
    } catch (error: any) {
      if (error instanceof SocialPublishingError) {
        res.status(error.statusCode).json({ success: false, error: error.message, details: error.details });
        return;
      }
      res.status(500).json({ success: false, error: error?.message || 'Failed to fetch comments' });
    }
  };

  public getPostReactions = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const result = await this.commentService.getFacebookPostReactions(id, userId);
      res.status(200).json(result);
    } catch (error: any) {
      if (error instanceof SocialPublishingError) {
        res.status(error.statusCode).json({ success: false, error: error.message, details: error.details });
        return;
      }
      res.status(500).json({ success: false, error: error?.message || 'Failed to fetch post reactions' });
    }
  };

  public getAccounts = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    const accounts = await this.postRepository.getAccounts(userId);
    res.json({
      success: true,
      count: accounts.length,
      accounts,
    });
  };

  public startConnect = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role || 'user';
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      if (!this.socialConnectService) {
        res.status(500).json({
          success: false,
          error: 'Social connection service is not configured.',
        });
        return;
      }

      const platform = Array.isArray(req.params.platform) ? req.params.platform[0] : req.params.platform;
      const redirectUrl =
        (req.query.redirect_url as string) ||
        (req.headers.origin ? `${req.headers.origin}/accounts` : 'http://localhost:5173/accounts');

      const result = await this.socialConnectService.getConnectUrl(
        userId,
        role,
        platform,
        redirectUrl,
        (req.user as any)?.email
      );

      res.json({
        success: true,
        authUrl: result.authUrl,
        profileId: result.profileId,
      });
    } catch (err: any) {
      if (err instanceof SocialPublishingError) {
        res.status(err.statusCode).json({
          success: false,
          error: err.message,
          details: err.details,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: err.message || 'Failed to initiate social account connection.',
      });
    }
  };

  public completeConnect = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role || 'user';
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      if (!this.socialConnectService) {
        res.status(500).json({
          success: false,
          error: 'Social connection service is not configured.',
        });
        return;
      }

      const payload = req.method === 'GET' ? req.query : req.body;
      const connected = payload.connected !== undefined ? payload.connected : true;

      const account = await this.socialConnectService.verifyAndSaveConnectedAccount(
        userId,
        role,
        {
          connected,
          profileId: payload.profileId as string,
          accountId: payload.accountId as string,
          username: payload.username as string,
          platform: payload.platform as string,
        }
      );

      if (req.method === 'GET') {
        const origin = req.headers.origin || 'http://localhost:5173';
        res.redirect(`${origin}/accounts?connected=true&accountId=${account.accountId}`);
        return;
      }

      res.json({
        success: true,
        message: 'Social account connected and verified successfully.',
        account,
      });
    } catch (err: any) {
      if (err instanceof SocialPublishingError) {
        if (req.method === 'GET') {
          const origin = req.headers.origin || 'http://localhost:5173';
          res.redirect(`${origin}/accounts?connected=false&error=${encodeURIComponent(err.message)}`);
          return;
        }
        res.status(err.statusCode).json({
          success: false,
          error: err.message,
          details: err.details,
        });
        return;
      }

      if (req.method === 'GET') {
        const origin = req.headers.origin || 'http://localhost:5173';
        res.redirect(`${origin}/accounts?connected=false&error=${encodeURIComponent(err.message || 'Connection failed')}`);
        return;
      }

      res.status(500).json({
        success: false,
        error: err.message || 'Failed to complete social account connection.',
      });
    }
  };

  public disconnectAccount = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user?.userId;
      const role = req.user?.role || 'user';
      if (!userId) {
        res.status(401).json({ success: false, error: 'Authentication required.' });
        return;
      }

      if (!this.socialConnectService) {
        res.status(500).json({
          success: false,
          error: 'Social connection service is not configured.',
        });
        return;
      }

      const rawAccountId = req.params.accountId;
      const accountId = Array.isArray(rawAccountId) ? rawAccountId[0] : rawAccountId;
      if (!accountId || typeof accountId !== 'string') {
        res.status(400).json({ success: false, error: 'accountId is required.' });
        return;
      }

      const result = await this.socialConnectService.disconnectAccount(userId, role, accountId);
      res.status(200).json(result);
    } catch (err: any) {
      if (err instanceof SocialPublishingError) {
        res.status(err.statusCode).json({
          success: false,
          error: err.message,
          details: err.details,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: err.message || 'Failed to disconnect account.',
      });
    }
  };
}
