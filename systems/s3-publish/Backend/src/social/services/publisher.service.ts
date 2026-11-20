import { v4 as uuidv4 } from 'uuid';
import {
  PublishPostInput,
  NormalizedPublishResult,
  SocialPublishingError,
  PostRecord,
} from '../types/publisher.types';
import { PlatformRouter } from '../router/platform.router';
import { ZernioPublisher } from '../providers/zernio/zernio.publisher';
import { PostRepositoryService } from './post-repository.service';

export class PublisherService {
  private platformRouter: PlatformRouter;
  private zernioPublisher: ZernioPublisher;
  private postRepository: PostRepositoryService;

  constructor(
    platformRouter: PlatformRouter,
    zernioPublisher: ZernioPublisher,
    postRepository: PostRepositoryService
  ) {
    this.platformRouter = platformRouter;
    this.zernioPublisher = zernioPublisher;
    this.postRepository = postRepository;
  }

  public async publishPost(input: PublishPostInput, userId?: string): Promise<NormalizedPublishResult> {
    // 1. Validate basic input requirements
    this.validateInput(input);

    // 2. Platform router validation
    const platformValidation = this.platformRouter.validatePlatforms(input.platforms, input);
    if (!platformValidation.valid) {
      throw new SocialPublishingError(
        `Validation Error: ${platformValidation.errors.join(' ')}`,
        400,
        { errors: platformValidation.errors }
      );
    }

    // 3. Idempotency handling
    const rawKey = input.idempotencyKey || `req_${uuidv4()}`;
    const storageKey = userId && !rawKey.startsWith(`${userId}:`) ? `${userId}:${rawKey}` : rawKey;

    const existingRecord = userId
      ? await this.postRepository.findByIdempotencyKey(rawKey, userId)
      : await this.postRepository.findUnscopedByIdempotencyKey(rawKey);
    if (existingRecord) {
      return {
        success: existingRecord.status === 'published' || existingRecord.status === 'scheduled',
        postId: existingRecord.internalPostId,
        status: existingRecord.status,
        platforms: existingRecord.platforms,
      };
    }

    const internalPostId = `post_${uuidv4()}`;

    // 4. Delegate to Zernio Publisher
    const result = await this.zernioPublisher.publish(input, storageKey, internalPostId);

    // 5. Store record in repository ONLY IF not completely failed or fake
    if (result.status !== 'failed') {
      const now = new Date().toISOString();
      const scheduledFor = input.scheduledFor || input.scheduledAt;
      const isScheduled = result.status === 'scheduled' || Boolean(scheduledFor && input.publishNow === false);
      const postPlatforms = (result.platforms || []).map((rp) => {
        const matchingInput = (input.platforms || []).find((ip) => ip.platform === rp.platform);
        return {
          ...rp,
          accountId: matchingInput?.accountId,
        };
      });

      const postRecord: PostRecord = {
        internalPostId,
        userId,
        providerPostId: result.postId && result.postId !== internalPostId ? result.postId : undefined,
        idempotencyKey: storageKey,
        caption: input.caption,
        imageUrl: input.imageUrl,
        publishNow: !isScheduled,
        scheduledFor: scheduledFor,
        timezone: input.timezone,
        status: result.status,
        platforms: postPlatforms,
        createdAt: now,
        updatedAt: now,
      };
      await this.postRepository.save(postRecord);
    }

    return {
      ...result,
      postId: internalPostId,
    };
  }

  private validateInput(input: PublishPostInput): void {
    if (!input) {
      throw new SocialPublishingError('Request body cannot be empty.', 400);
    }

    if (!input.platforms || !Array.isArray(input.platforms) || input.platforms.length === 0) {
      throw new SocialPublishingError('At least one platform must be specified in platforms array.', 400);
    }

    if (input.imageUrl && typeof input.imageUrl === 'string') {
      const trimmed = input.imageUrl.trim();
      if (!trimmed) {
        input.imageUrl = undefined;
      } else {
        try {
          new URL(trimmed);
        } catch (_e) {
          throw new SocialPublishingError('Invalid imageUrl format. Must be a valid URL string.', 400);
        }
      }
    }

    // Caption required for text-only posts
    if (!input.imageUrl && (!input.caption || input.caption.trim() === '')) {
      throw new SocialPublishingError('Caption is required for text posts.', 400);
    }
  }
}
