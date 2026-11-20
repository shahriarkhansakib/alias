import { ZernioClient } from './zernio.client';
import { ZernioCreatePostPayload, ZernioCreatePostResponse } from './zernio.types';
import {
  PublishPostInput,
  NormalizedPublishResult,
  PlatformPublishResult,
  SocialPublishingError,
} from '../../types/publisher.types';
import { PlatformRouter } from '../../router/platform.router';

export class ZernioPublisher {
  private zernioClient: ZernioClient;
  private platformRouter: PlatformRouter;

  constructor(zernioClient: ZernioClient, platformRouter: PlatformRouter) {
    this.zernioClient = zernioClient;
    this.platformRouter = platformRouter;
  }

  public async publish(
    input: PublishPostInput,
    idempotencyKey: string,
    internalPostId: string
  ): Promise<NormalizedPublishResult> {
    const formattedPlatforms = this.platformRouter.formatPlatformTargets(input.platforms, input);

    const payload: ZernioCreatePostPayload = {
      platforms: formattedPlatforms,
    };

    if (input.caption && input.caption.trim()) {
      payload.content = input.caption.trim();
    }

    if (input.imageUrl && input.imageUrl.trim()) {
      payload.mediaItems = [
        {
          type: 'image',
          url: input.imageUrl.trim(),
        },
      ];
    }

    const scheduledTime = input.scheduledFor || input.scheduledAt;
    if (scheduledTime) {
      payload.scheduledFor = scheduledTime;
      if (input.timezone) {
        payload.timezone = input.timezone;
      }
    } else if (input.publishNow === false) {
      payload.publishNow = false;
    } else {
      payload.publishNow = true;
    }

    try {
      const response: ZernioCreatePostResponse = await this.zernioClient.createPost(payload, idempotencyKey);
      return this.normalizeSuccessResponse(response, input, internalPostId);
    } catch (error: any) {
      if (error instanceof SocialPublishingError) {
        return this.normalizeErrorResponse(error, input, internalPostId);
      }
      return this.normalizeErrorResponse(
        new SocialPublishingError(error.message || 'Unknown publishing error', 500),
        input,
        internalPostId
      );
    }
  }

  private normalizeSuccessResponse(
    response: ZernioCreatePostResponse,
    input: PublishPostInput,
    internalPostId: string
  ): NormalizedPublishResult {
    const zernioPost = response.post;
    const responsePlatforms = zernioPost?.platforms || response.platforms || [];
    const isScheduled = Boolean(input.scheduledFor || input.scheduledAt || input.publishNow === false);
    const defaultStatus = isScheduled ? 'scheduled' : 'published';
    const overallStatus = (zernioPost?.status || response.status || defaultStatus) as 'published' | 'scheduled' | 'failed' | 'partial';
    
    const platformResults: PlatformPublishResult[] = input.platforms.map((p) => {
      const respPlatform = responsePlatforms.find(
        (rp) => rp.platform.toLowerCase() === p.platform.toLowerCase()
      );

      if (respPlatform) {
        let mappedStatus: 'published' | 'scheduled' | 'failed' = defaultStatus;
        if (respPlatform.status === 'published' || respPlatform.status === 'scheduled' || respPlatform.status === 'failed') {
          mappedStatus = respPlatform.status;
        } else if ((respPlatform.status as string) === 'pending') {
          mappedStatus = 'scheduled';
        }

        return {
          platform: p.platform,
          status: mappedStatus,
          platformPostId: respPlatform.platformPostId,
          platformPostUrl: respPlatform.platformPostUrl,
          error: respPlatform.error,
        };
      }

      return {
        platform: p.platform,
        status: defaultStatus,
      };
    });

    const hasSuccess =
      platformResults.some((p) => p.status === 'published' || p.status === 'scheduled') ||
      overallStatus === 'scheduled' ||
      overallStatus === 'published';
    const hasFailure = platformResults.some((p) => p.status === 'failed');

    let finalStatus: 'published' | 'scheduled' | 'failed' | 'partial' = overallStatus;
    if ((finalStatus as string) === 'pending') {
      finalStatus = 'scheduled';
    }
    if (hasSuccess && hasFailure) {
      finalStatus = 'partial';
    } else if (!hasSuccess && hasFailure) {
      finalStatus = 'failed';
    }

    return {
      success: hasSuccess,
      postId: zernioPost?._id || response.id || response.postId || internalPostId,
      status: finalStatus,
      platforms: platformResults,
    };
  }

  private normalizeErrorResponse(
    error: SocialPublishingError,
    input: PublishPostInput,
    internalPostId: string
  ): NormalizedPublishResult {
    const isScheduled = Boolean(input.scheduledFor || input.scheduledAt || input.publishNow === false);

    // If scheduling failed because of upstream Zernio 400 (validation/date window/plan constraint),
    // fallback gracefully to local scheduling
    if (isScheduled && error.statusCode === 400) {
      console.warn('[ZernioPublisher] Upstream Zernio rejected scheduling with 400. Falling back to local engine scheduling:', error.message);
      const platformResults: PlatformPublishResult[] = input.platforms.map((p) => ({
        platform: p.platform,
        status: 'scheduled',
      }));

      return {
        success: true,
        postId: internalPostId,
        status: 'scheduled',
        platforms: platformResults,
      };
    }

    const platformResults: PlatformPublishResult[] = input.platforms.map((p) => ({
      platform: p.platform,
      status: 'failed',
      error: error.message,
    }));

    return {
      success: false,
      postId: internalPostId,
      status: 'failed',
      platforms: platformResults,
      error: error.message,
    };
  }
}

