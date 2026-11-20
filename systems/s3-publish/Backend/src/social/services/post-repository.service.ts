import { v4 as uuidv4 } from 'uuid';
import { PostRecord, SocialPublishingError } from '../types/publisher.types';
import { getDbPool } from '../../db';

export interface SocialAccountRecord {
  id: string;
  userId: string;
  platform: string;
  accountId: string;
  displayName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export class PostRepositoryService {
  private posts: Map<string, PostRecord> = new Map();
  private idempotencyMap: Map<string, string> = new Map();
  private accounts: Map<string, SocialAccountRecord> = new Map();

  public async save(post: PostRecord): Promise<void> {
    this.posts.set(post.internalPostId, post);

    if (post.idempotencyKey) {
      this.idempotencyMap.set(post.idempotencyKey, post.internalPostId);
    }

    const pool = getDbPool();

    if (pool) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const publishedAt = post.status === 'published' ? new Date() : null;
        const scheduledFor = post.scheduledFor ? new Date(post.scheduledFor) : null;
        const timezone = post.timezone || null;
        const publishNow =
          post.publishNow !== undefined
            ? post.publishNow
            : post.status === 'published';

        await client.query(
          `INSERT INTO posts
           (
             id,
             user_id,
             idempotency_key,
             caption,
             media_url,
             status,
             created_at,
             published_at,
             scheduled_for,
             timezone,
             publish_now
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
             $11
           )
           ON CONFLICT (id)
           DO UPDATE SET
             user_id = COALESCE(EXCLUDED.user_id, posts.user_id),
             status = EXCLUDED.status,
             caption = EXCLUDED.caption,
             media_url = EXCLUDED.media_url,
             published_at = EXCLUDED.published_at,
             scheduled_for = EXCLUDED.scheduled_for,
             timezone = EXCLUDED.timezone,
             publish_now = EXCLUDED.publish_now,
             updated_at = NOW()`,
          [
            post.internalPostId,
            post.userId || null,
            post.idempotencyKey,
            post.caption || null,
            post.imageUrl || null,
            post.status,
            post.createdAt ? new Date(post.createdAt) : new Date(),
            publishedAt,
            scheduledFor,
            timezone,
            publishNow,
          ]
        );

        for (const pl of post.platforms) {
          const platformPostId = pl.platformPostId || null;
          const zernioPostId = post.providerPostId || null;
          const platformPostUrl = pl.platformPostUrl || null;
          const plAccountId = (pl as any).accountId || null;
          const pfStatus = pl.status || post.status;
          const pfPublishedAt = pfStatus === 'published' ? new Date() : null;

          const existing = await client.query(
            `SELECT id
             FROM post_platforms
             WHERE post_id = $1
               AND platform = $2
             LIMIT 1`,
            [post.internalPostId, pl.platform]
          );

          if (existing.rows.length > 0) {
            await client.query(
              `UPDATE post_platforms
               SET
                 zernio_post_id = COALESCE($1, zernio_post_id),
                 platform_post_id = COALESCE($2, platform_post_id),
                 platform_post_url = COALESCE($3, platform_post_url),
                 account_id = COALESCE($4, account_id),
                 status = $5,
                 published_at = $6
               WHERE id = $7`,
              [
                zernioPostId,
                platformPostId,
                platformPostUrl,
                plAccountId,
                pfStatus,
                pfPublishedAt,
                existing.rows[0].id,
              ]
            );
          } else {
            const platformRecordId = `pp_${uuidv4()}`;

            await client.query(
              `INSERT INTO post_platforms
               (
                 id,
                 post_id,
                 platform,
                 account_id,
                 zernio_post_id,
                 platform_post_id,
                 platform_post_url,
                 status,
                 published_at
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
                 $9
               )`,
              [
                platformRecordId,
                post.internalPostId,
                pl.platform,
                plAccountId,
                zernioPostId,
                platformPostId,
                platformPostUrl,
                pfStatus,
                pfPublishedAt,
              ]
            );
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.error('[PostRepository] DB save failed:', err);
      } finally {
        client.release();
      }
    }
  }

  public async findById(
    internalPostId: string,
    userId?: string
  ): Promise<PostRecord | undefined> {
    const pool = getDbPool();

    if (pool) {
      try {
        const query = userId
          ? 'SELECT * FROM posts WHERE id = $1 AND user_id = $2'
          : 'SELECT * FROM posts WHERE id = $1';
        const params = userId ? [internalPostId, userId] : [internalPostId];
        const postRes = await pool.query(query, params);

        if (postRes.rows.length > 0) {
          const row = postRes.rows[0];

          const platformsRes = await pool.query(
            `SELECT *
             FROM post_platforms
             WHERE post_id = $1`,
            [internalPostId]
          );

          const platforms = platformsRes.rows.map((pr: any) => ({
            platform: pr.platform,
            status: pr.status,
            accountId: pr.account_id || undefined,
            zernioPostId: pr.zernio_post_id || undefined,
            platformPostId: pr.platform_post_id || undefined,
            platformPostUrl: pr.platform_post_url || undefined,
          }));

          const providerPostId =
            platformsRes.rows.find((pr: any) => pr.zernio_post_id)?.zernio_post_id ||
            undefined;

          return {
            internalPostId: row.id,
            userId: row.user_id || undefined,
            providerPostId,
            idempotencyKey: row.idempotency_key,
            caption: row.caption || undefined,
            imageUrl: row.media_url || undefined,
            publishNow:
              row.publish_now !== undefined && row.publish_now !== null
                ? Boolean(row.publish_now)
                : row.status === 'published',
            scheduledFor: row.scheduled_for
              ? new Date(row.scheduled_for).toISOString()
              : undefined,
            timezone: row.timezone || undefined,
            status: row.status,
            platforms,
            createdAt: row.created_at
              ? new Date(row.created_at).toISOString()
              : new Date().toISOString(),
            updatedAt: row.updated_at
              ? new Date(row.updated_at).toISOString()
              : row.created_at
                ? new Date(row.created_at).toISOString()
                : new Date().toISOString(),
          };
        }
      } catch (err) {
        console.error('[PostRepository] DB findById failed, falling back to memory:', err);
      }
    }

    const post = this.posts.get(internalPostId);
    if (!post) return undefined;
    if (userId && post.userId !== userId) {
      return undefined;
    }
    return post;
  }

  /**
   * Scoped idempotency lookup for authenticated operations.
   * Matches ONLY records owned by the exact userId.
   * Never matches records where user_id IS NULL or where user_id belongs to another user.
   */
  public async findByIdempotencyKey(
    idempotencyKey: string,
    userId?: string
  ): Promise<PostRecord | undefined> {
    if (!userId) {
      return this.findUnscopedByIdempotencyKey(idempotencyKey);
    }

    const pool = getDbPool();

    const storageKey = !idempotencyKey.startsWith(`${userId}:`)
      ? `${userId}:${idempotencyKey}`
      : idempotencyKey;

    if (pool) {
      try {
        const query = `SELECT id
             FROM posts
             WHERE (idempotency_key = $1 OR idempotency_key = $2)
               AND user_id = $3
             LIMIT 1`;

        const params = [storageKey, idempotencyKey, userId];
        const postRes = await pool.query(query, params);

        if (postRes.rows.length > 0) {
          return this.findById(postRes.rows[0].id, userId);
        }
      } catch (err) {
        console.error('[PostRepository] DB findByIdempotencyKey failed:', err);
      }
    }

    // In-memory fallback: strictly enforce exact ownership match
    const internalPostId =
      this.idempotencyMap.get(storageKey) || this.idempotencyMap.get(idempotencyKey);
    if (internalPostId) {
      const post = this.posts.get(internalPostId);
      if (post) {
        if (post.userId === userId) {
          return post;
        }
        return undefined;
      }
    }

    return undefined;
  }

  /**
   * Internal unscoped lookup for maintenance / legacy scripts.
   * HTTP publish cannot call this as SocialController.publish strictly enforces authenticated userId.
   */
  public async findUnscopedByIdempotencyKey(
    idempotencyKey: string
  ): Promise<PostRecord | undefined> {
    const pool = getDbPool();

    if (pool) {
      try {
        const postRes = await pool.query(
          `SELECT id
           FROM posts
           WHERE idempotency_key = $1
           LIMIT 1`,
          [idempotencyKey]
        );

        if (postRes.rows.length > 0) {
          return this.findById(postRes.rows[0].id);
        }
      } catch (err) {
        console.error('[PostRepository] DB findUnscopedByIdempotencyKey failed:', err);
      }
    }

    const internalPostId = this.idempotencyMap.get(idempotencyKey);
    if (internalPostId) {
      return this.posts.get(internalPostId);
    }

    return undefined;
  }

  public async resolveZernioPostId(
    postIdOrZernioId: string,
    userId?: string
  ): Promise<string> {
    const pool = getDbPool();

    if (pool) {
      try {
        const query = userId
          ? `SELECT pp.zernio_post_id, pp.platform_post_id
             FROM post_platforms pp
             JOIN posts p ON pp.post_id = p.id
             WHERE (pp.post_id = $1 OR pp.zernio_post_id = $1 OR pp.platform_post_id = $1)
               AND p.user_id = $2
             ORDER BY
               CASE
                 WHEN pp.post_id = $1 THEN 1
                 WHEN pp.zernio_post_id = $1 THEN 2
                 WHEN pp.platform_post_id = $1 THEN 3
                 ELSE 4
               END
             LIMIT 1`
          : `SELECT pp.zernio_post_id, pp.platform_post_id
             FROM post_platforms pp
             WHERE pp.post_id = $1 OR pp.zernio_post_id = $1 OR pp.platform_post_id = $1
             ORDER BY
               CASE
                 WHEN pp.post_id = $1 THEN 1
                 WHEN pp.zernio_post_id = $1 THEN 2
                 WHEN pp.platform_post_id = $1 THEN 3
                 ELSE 4
               END
             LIMIT 1`;

        const params = userId ? [postIdOrZernioId, userId] : [postIdOrZernioId];
        const res = await pool.query(query, params);

        if (res.rows.length > 0) {
          const row = res.rows[0];
          if (row.zernio_post_id) {
            return String(row.zernio_post_id);
          }
          if (row.platform_post_id) {
            return String(row.platform_post_id);
          }
        }
      } catch (err) {
        console.error('[PostRepository] DB resolveZernioPostId failed:', err);
      }
    }

    let post = this.posts.get(postIdOrZernioId);
    if (!post) {
      post = Array.from(this.posts.values()).find(
        (p) =>
          p.providerPostId === postIdOrZernioId ||
          p.platforms?.some(
            (pl) =>
              pl.platformPostId === postIdOrZernioId ||
              (pl as any).zernioPostId === postIdOrZernioId
          )
      );
    }
    if (post) {
      if (userId && post.userId !== userId) {
        return postIdOrZernioId;
      }
      if (post.providerPostId) {
        return String(post.providerPostId);
      }
      if (Array.isArray(post.platforms)) {
        const platformPost = post.platforms.find((p) => p.platformPostId);
        if (platformPost?.platformPostId) {
          return String(platformPost.platformPostId);
        }
      }
    }

    return postIdOrZernioId;
  }

  public async listAll(userId?: string): Promise<PostRecord[]> {
    const pool = getDbPool();

    if (pool) {
      try {
        const query = userId
          ? 'SELECT id FROM posts WHERE user_id = $1 ORDER BY created_at DESC'
          : 'SELECT id FROM posts ORDER BY created_at DESC';
        const params = userId ? [userId] : [];
        const postRes = await pool.query(query, params);

        const results: PostRecord[] = [];
        for (const row of postRes.rows) {
          const rec = await this.findById(row.id, userId);
          if (rec) {
            results.push(rec);
          }
        }

        return results;
      } catch (err) {
        console.error('[PostRepository] DB listAll failed, falling back to memory:', err);
      }
    }

    let all = Array.from(this.posts.values());
    if (userId) {
      all = all.filter((p) => p.userId === userId);
    }

    return all.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public async saveAccount(account: SocialAccountRecord): Promise<void> {
    // 1. In-memory conflict check: prevent cross-user account assignment
    const existingMemory = Array.from(this.accounts.values()).find(
      (a) =>
        (a.id === account.id ||
          (a.platform.toLowerCase() === account.platform.toLowerCase() &&
            a.accountId === account.accountId)) &&
        a.userId &&
        a.userId !== account.userId
    );
    if (existingMemory) {
      throw new SocialPublishingError(
        'Conflict: this social account is already associated with another user.',
        409
      );
    }

    // 2. Database conflict check & upsert
    const pool = getDbPool();
    if (pool) {
      try {
        const existingRes = await pool.query(
          `SELECT id, user_id FROM social_accounts
           WHERE (id = $1 OR (platform = $2 AND account_id = $3))
             AND user_id IS NOT NULL AND user_id != $4
           LIMIT 1`,
          [account.id, account.platform, account.accountId, account.userId]
        );
        if (existingRes.rows.length > 0) {
          throw new SocialPublishingError(
            'Conflict: this social account is already associated with another user.',
            409
          );
        }

        await pool.query(
          `INSERT INTO social_accounts (id, platform, account_id, display_name, user_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
             platform = EXCLUDED.platform,
             account_id = EXCLUDED.account_id,
             display_name = EXCLUDED.display_name,
             user_id = EXCLUDED.user_id,
             updated_at = NOW()
           WHERE social_accounts.user_id = EXCLUDED.user_id OR social_accounts.user_id IS NULL`,
          [
            account.id,
            account.platform,
            account.accountId,
            account.displayName || null,
            account.userId,
          ]
        );
      } catch (err) {
        if (err instanceof SocialPublishingError) throw err;
        console.error('[PostRepository] DB saveAccount failed:', err);
      }
    }

    this.accounts.set(account.id, account);
  }

  public async getAccountById(
    accountId: string
  ): Promise<SocialAccountRecord | null> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, platform, account_id as "accountId", display_name as "displayName", user_id as "userId"
           FROM social_accounts
           WHERE id = $1 OR account_id = $1
           LIMIT 1`,
          [accountId]
        );
        if (res.rows.length > 0) {
          return {
            id: res.rows[0].id,
            platform: res.rows[0].platform,
            accountId: res.rows[0].accountId,
            displayName: res.rows[0].displayName || undefined,
            userId: res.rows[0].userId,
          };
        }
      } catch (err) {
        console.error('[PostRepository] DB getAccountById failed:', err);
      }
    }

    const acc = Array.from(this.accounts.values()).find(
      (a) => a.id === accountId || a.accountId === accountId
    );
    return acc || null;
  }

  public async getAccounts(
    userId: string
  ): Promise<Array<{ id: string; platform: string; accountId: string; displayName?: string }>> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT id, platform, account_id as "accountId", display_name as "displayName"
           FROM social_accounts
           WHERE user_id = $1
           ORDER BY created_at ASC`,
          [userId]
        );
        if (res.rows.length > 0) {
          return res.rows.map((r: any) => ({
            id: r.id,
            platform: r.platform,
            accountId: r.accountId,
            displayName: r.displayName || undefined,
          }));
        }
      } catch (err) {
        console.error('[PostRepository] DB getAccounts failed:', err);
      }
    }

    return Array.from(this.accounts.values())
      .filter((a) => a.userId === userId)
      .map((a) => ({
        id: a.id,
        platform: a.platform,
        accountId: a.accountId,
        displayName: a.displayName,
      }));
  }

  public async isAccountOwnedByUser(
    userId: string,
    accountId: string
  ): Promise<boolean> {
    const pool = getDbPool();
    if (pool) {
      try {
        const res = await pool.query(
          `SELECT 1 FROM social_accounts
           WHERE user_id = $1 AND (id = $2 OR account_id = $2)
           LIMIT 1`,
          [userId, accountId]
        );
        if (res.rows.length > 0) return true;
      } catch (err) {
        console.error('[PostRepository] DB isAccountOwnedByUser failed:', err);
      }
    }

    const acc = Array.from(this.accounts.values()).find(
      (a) => a.userId === userId && (a.id === accountId || a.accountId === accountId)
    );
    return !!acc;
  }

  public async deleteAccount(
    userId: string,
    accountId: string
  ): Promise<boolean> {
    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          `DELETE FROM social_accounts
           WHERE user_id = $1 AND (id = $2 OR account_id = $2)`,
          [userId, accountId]
        );
      } catch (err) {
        console.error('[PostRepository] DB deleteAccount failed:', err);
      }
    }

    const keysToDelete: string[] = [];
    for (const [key, acc] of this.accounts.entries()) {
      if (acc.userId === userId && (acc.id === accountId || acc.accountId === accountId)) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.accounts.delete(key);
    }
    return true;
  }

  public async clear(): Promise<void> {
    this.posts.clear();
    this.idempotencyMap.clear();
    this.accounts.clear();

    const pool = getDbPool();

    if (pool) {
      try {
        await pool.query(
          `TRUNCATE
             analytics_timeline,
             analytics_snapshots,
             post_platforms,
             posts,
             social_accounts
           CASCADE`
        );
      } catch (err) {
        console.error('[PostRepository] DB clear failed:', err);
      }
    }
  }
}
