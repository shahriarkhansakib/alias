import axios from 'axios';
import { ZernioClient } from '../providers/zernio/zernio.client';
import { PostRepositoryService } from './post-repository.service';
import { SocialPublishingError } from '../types/publisher.types';

export interface NormalizedComment {
  id: string;
  text: string;
  authorName: string;
  createdAt: string | null;
}

export interface GetCommentsResult {
  success: boolean;
  postId: string;
  comments: NormalizedComment[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface FacebookReactionCounts {
  like: number | null;
  love: number | null;
  haha: number | null;
  wow: number | null;
  sad: number | null;
  angry: number | null;
  care: number | null;
}

export interface GetPostReactionsResult {
  success: boolean;
  postId: string;
  platformPostId: string;
  total: number | null;
  reactions: FacebookReactionCounts;
}

function parseReactionCount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return isNaN(value) || value < 0 ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) || parsed < 0 ? null : parsed;
  }
  return null;
}

export class CommentService {
  private zernioClient: ZernioClient;
  private postRepository: PostRepositoryService;

  constructor(
    zernioClient: ZernioClient,
    postRepository: PostRepositoryService
  ) {
    this.zernioClient = zernioClient;
    this.postRepository = postRepository;
  }

  public async getPostComments(
    postId: string,
    userId: string,
    cursor?: string,
    limit: number = 25
  ): Promise<GetCommentsResult> {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new SocialPublishingError('Authentication required to view comments.', 401);
    }

    if (!postId || typeof postId !== 'string' || !postId.trim()) {
      throw new SocialPublishingError('postId is required.', 400);
    }

    // 1. Exact user ownership check: load the post scoped strictly to userId
    // Never matches user_id IS NULL or other users' posts
    const post = await this.postRepository.findById(postId.trim(), userId.trim());
    if (!post) {
      throw new SocialPublishingError(`Post with ID '${postId}' not found.`, 404);
    }

    // 2. Server-side accountId resolution:
    // Check if the post targets Facebook and resolve the verified accountId owned by this user
    const fbPlatform = post.platforms?.find(
      (pl) => (pl.platform || '').toLowerCase() === 'facebook'
    );

    if (!fbPlatform) {
      throw new SocialPublishingError(
        'Facebook comments are only supported for posts published to Facebook.',
        400
      );
    }

    let resolvedAccountId: string | undefined = fbPlatform.accountId;

    // Verify ownership of the accountId
    let isOwned = false;
    if (resolvedAccountId) {
      isOwned = await this.postRepository.isAccountOwnedByUser(userId.trim(), resolvedAccountId);
      if (!isOwned) {
        throw new SocialPublishingError(
          'Could not securely match a connected Facebook account for this post.',
          400
        );
      }
    } else {
      // If missing on platform row, fallback to user's connected Facebook accounts
      const userAccounts = await this.postRepository.getAccounts(userId.trim());
      const userFbAccount = userAccounts.find(
        (acc) => (acc.platform || '').toLowerCase() === 'facebook'
      );
      if (userFbAccount && userFbAccount.accountId) {
        resolvedAccountId = userFbAccount.accountId;
        isOwned = true;
      }
    }

    // If still not matched or verified, fail closed
    if (!resolvedAccountId || !isOwned) {
      throw new SocialPublishingError(
        'Could not securely match a connected Facebook account for this post.',
        400
      );
    }

    // 3. Resolve supported post identifiers
    const providerPostId = post.providerPostId?.trim() || undefined;
    const platformPostId = fbPlatform.platformPostId?.trim() || undefined;

    let primaryPostId: string | undefined = providerPostId || platformPostId;

    if (!primaryPostId) {
      const resolved = await this.postRepository.resolveZernioPostId(postId.trim(), userId.trim());
      if (resolved && resolved.trim() && resolved.trim() !== postId.trim()) {
        primaryPostId = resolved.trim();
      }
    }

    if (!primaryPostId) {
      throw new SocialPublishingError(
        'No supported Facebook post identifier found for this post.',
        400
      );
    }

    const shouldRetryWithNativeId = Boolean(
      platformPostId &&
      platformPostId !== primaryPostId
    );

    // 4. Fetch from Zernio Client (with single fallback retry on HTTP 404 if platformPostId is distinct)
    let rawResult: {
      comments: any[];
      pagination: { hasMore: boolean; nextCursor: string | null };
    };

    try {
      rawResult = await this.zernioClient.getPostComments(
        primaryPostId,
        resolvedAccountId,
        cursor,
        limit
      );
    } catch (err: unknown) {
      const is404 =
        (err instanceof SocialPublishingError && err.statusCode === 404) ||
        (axios.isAxiosError(err) && err.response?.status === 404);

      if (is404 && shouldRetryWithNativeId && platformPostId) {
        rawResult = await this.zernioClient.getPostComments(
          platformPostId,
          resolvedAccountId,
          cursor,
          limit
        );
      } else {
        throw err;
      }
    }

    // 5. Normalize comments:
    // - Show comment text
    // - Show author display name if provided (or 'Anonymous')
    // - Do NOT include or display from.id
    // - Show creation time ONLY when response contains a verified creation-time field (otherwise null)
    // - Never use fetch time as comment time
    // - Do NOT log raw Zernio responses or comment text
    const normalizedComments: NormalizedComment[] = (rawResult.comments || []).map(
      (raw: any, index: number) => {
        const text = String(raw.comment ?? raw.text ?? raw.message ?? '').trim();

        const authorName = String(
          raw.from?.name ||
          raw.from?.username ||
          raw.author?.name ||
          raw.author?.username ||
          'Anonymous'
        ).trim();

        // Check for verified creation-time field (e.g. createdTime, createdAt, created_time, timestamp)
        const rawTime =
          raw.createdTime ??
          raw.createdAt ??
          raw.created_time ??
          raw.timestamp ??
          null;
        let verifiedCreatedAt: string | null = null;
        if (rawTime && (typeof rawTime === 'string' || typeof rawTime === 'number')) {
          const parsed = new Date(rawTime);
          if (!isNaN(parsed.getTime())) {
            verifiedCreatedAt = parsed.toISOString();
          }
        }

        return {
          id: String(raw.id || raw._id || `comment_${index}`),
          text,
          authorName,
          createdAt: verifiedCreatedAt,
        };
      }
    );

    return {
      success: true,
      postId: post.internalPostId,
      comments: normalizedComments,
      pagination: {
        hasMore: rawResult.pagination.hasMore,
        nextCursor: rawResult.pagination.nextCursor,
      },
    };
  }

  public async getFacebookPostReactions(
    postId: string,
    userId: string
  ): Promise<GetPostReactionsResult> {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new SocialPublishingError('Authentication required to view post reactions.', 401);
    }

    if (!postId || typeof postId !== 'string' || !postId.trim()) {
      throw new SocialPublishingError('postId is required.', 400);
    }

    // 1. Exact user ownership check: load the post scoped strictly to userId
    // Never matches user_id IS NULL or other users' posts
    const post = await this.postRepository.findById(postId.trim(), userId.trim());
    if (!post) {
      throw new SocialPublishingError(`Post with ID '${postId}' not found.`, 404);
    }

    // 2. Platform check: must target Facebook
    const fbPlatform = post.platforms?.find(
      (pl) => (pl.platform || '').toLowerCase() === 'facebook'
    );

    if (!fbPlatform) {
      throw new SocialPublishingError(
        'Facebook post reactions are only supported for posts published to Facebook.',
        400
      );
    }

    // 3. Native post ID selection: must use Facebook native platformPostId only.
    // Do NOT substitute Zernio provider post ID. Fail closed if missing.
    const nativePostId = fbPlatform.platformPostId?.trim();
    if (!nativePostId) {
      throw new SocialPublishingError(
        'Facebook native post ID (platformPostId) is missing for this post.',
        400
      );
    }

    // 4. Server-side accountId resolution and ownership check:
    let resolvedAccountId: string | undefined = fbPlatform.accountId;

    let isOwned = false;
    if (resolvedAccountId) {
      isOwned = await this.postRepository.isAccountOwnedByUser(userId.trim(), resolvedAccountId);
      if (!isOwned) {
        throw new SocialPublishingError(
          'Could not securely match a connected Facebook account for this post.',
          400
        );
      }
    } else {
      const userAccounts = await this.postRepository.getAccounts(userId.trim());
      const userFbAccount = userAccounts.find(
        (acc) => (acc.platform || '').toLowerCase() === 'facebook'
      );
      if (userFbAccount && userFbAccount.accountId) {
        resolvedAccountId = userFbAccount.accountId;
        isOwned = true;
      }
    }

    if (!resolvedAccountId || !isOwned) {
      throw new SocialPublishingError(
        'Could not securely match a connected Facebook account for this post.',
        400
      );
    }

    // 5. Fetch from Zernio
    const rawResult = await this.zernioClient.getFacebookPostReactions(
      resolvedAccountId,
      nativePostId
    );

    // 6. Parse counts safely without inventing numbers
    const payload = rawResult?.data ?? rawResult ?? {};
    const rawTotal =
      payload.total ??
      payload.breakdown?.total ??
      payload.reactions?.total;
    const total = parseReactionCount(rawTotal);

    const getCount = (k: string) => {
      const val =
        payload.breakdown?.[k] ??
        payload[k] ??
        payload.reactions?.[k] ??
        payload.counts?.[k] ??
        payload.data?.[k] ??
        payload.data?.breakdown?.[k];
      return parseReactionCount(val);
    };

    const reactions: FacebookReactionCounts = {
      like: getCount('like'),
      love: getCount('love'),
      haha: getCount('haha'),
      wow: getCount('wow'),
      sad: getCount('sad'),
      angry: getCount('angry'),
      care: getCount('care'),
    };

    return {
      success: true,
      postId: post.internalPostId,
      platformPostId: nativePostId,
      total,
      reactions,
    };
  }
}

