import { PostRepositoryService } from './post-repository.service';
import { ZernioPublisher } from '../providers/zernio/zernio.publisher';
import { PostRecord } from '../types/publisher.types';
import { v4 as uuidv4 } from 'uuid';

export class ScheduledPostService {
  private postRepository: PostRepositoryService;
  private zernioPublisher: ZernioPublisher;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(postRepository: PostRepositoryService, zernioPublisher: ZernioPublisher) {
    this.postRepository = postRepository;
    this.zernioPublisher = zernioPublisher;
  }

  public async dispatchDuePosts(): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;
    let dispatchedCount = 0;

    try {
      const allPosts = await this.postRepository.listAll();
      const now = Date.now();

      const duePosts = allPosts.filter((post: PostRecord) => {
        if (post.status !== 'scheduled' || !post.scheduledFor) {
          return false;
        }
        const scheduledTime = new Date(post.scheduledFor).getTime();
        return !isNaN(scheduledTime) && scheduledTime <= now;
      });

      for (const post of duePosts) {
        try {
          console.log(`[ScheduledPostService] Dispatching due post: ${post.internalPostId} (scheduled for ${post.scheduledFor})`);

          const targetPlatforms = Array.isArray(post.platforms) && post.platforms.length > 0
            ? post.platforms.map((p) => ({
              platform: p.platform,
              accountId: (p as any).accountId || '6ab3ef6b8d284ffb21357563',
            }))
            : [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }];

          const publishInput = {
            caption: post.caption,
            imageUrl: post.imageUrl,
            platforms: targetPlatforms,
            publishNow: true,
          };

          const dispatchKey = `sched_exec_${post.internalPostId}_${uuidv4().substring(0, 8)}`;
          const result = await this.zernioPublisher.publish(publishInput, dispatchKey, post.internalPostId);

          if (result.success || result.status === 'published') {
            const updatedPost: PostRecord = {
              ...post,
              userId: post.userId,
              providerPostId: result.postId && result.postId !== post.internalPostId ? result.postId : post.providerPostId,
              status: 'published',
              publishNow: true,
              platforms: result.platforms,
              updatedAt: new Date().toISOString(),
            };
            await this.postRepository.save(updatedPost);
            dispatchedCount++;
            console.log(`[ScheduledPostService] Successfully published due post: ${post.internalPostId}`);
          }
        } catch (postErr) {
          console.warn(`[ScheduledPostService] Failed to dispatch due post ${post.internalPostId}:`, postErr);
        }
      }
    } catch (err) {
      console.warn('[ScheduledPostService] Error checking due scheduled posts:', err);
    } finally {
      this.isProcessing = false;
    }

    return dispatchedCount;
  }

  public start(intervalMs: number = 30000): void {
    if (process.env.NODE_ENV === 'test') {
      return; // Do not start background interval in test environment to avoid open handles
    }

    if (this.timer) {
      clearInterval(this.timer);
    }

    this.timer = setInterval(() => {
      this.dispatchDuePosts().catch((err) => {
        console.warn('[ScheduledPostService] Interval run failed:', err);
      });
    }, intervalMs);

    // unref ensures this timer does not prevent process exit
    if (this.timer.unref) {
      this.timer.unref();
    }

    console.log(`[ScheduledPostService] Background scheduler started (polling every ${intervalMs / 1000}s)`);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
