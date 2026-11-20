import { v4 as uuidv4 } from 'uuid';
import { getDbPool } from '../db';

/**
 * Application-specific fixed keys for transaction-scoped PostgreSQL advisory lock.
 * pg_advisory_xact_lock(classid, objid) serializes concurrent first-time Owner setup
 * and automatically releases the lock upon COMMIT or ROLLBACK.
 */
export const OWNER_SETUP_LOCK_KEY_1 = 1514525262; // 0x5a45524e: 'ZERN'
export const OWNER_SETUP_LOCK_KEY_2 = 1331124050; // 0x4f574e52: 'OWNR'

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'owner' | 'user';
  createdAt: string;
  zernioProfileId?: string;
}

export class UserRepository {
  private static profileCache: Map<string, string> = new Map();
  private memoryUsers: Map<string, User> = new Map();
  private memoryLegacyAssigned = false;
  private memoryOwnerAccounts: Map<string, any> = new Map();

  async findByEmail(email: string): Promise<User | null> {
    const pool = getDbPool();
    if (pool) {
      let result;
      try {
        result = await pool.query(
          'SELECT id, email, password_hash, role, created_at, zernio_profile_id FROM users WHERE email = $1',
          [email]
        );
      } catch {
        // Fallback if migration 004 is not yet applied
        result = await pool.query(
          'SELECT id, email, password_hash, role, created_at FROM users WHERE email = $1',
          [email]
        );
      }
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      const cachedProfileId = UserRepository.profileCache.get(row.id);
      const cleanProfileId =
        typeof row.zernio_profile_id === 'string' && row.zernio_profile_id.trim()
          ? row.zernio_profile_id.trim()
          : typeof cachedProfileId === 'string' && cachedProfileId.trim()
          ? cachedProfileId.trim()
          : undefined;

      return {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        role: row.role as 'owner' | 'user',
        createdAt: row.created_at,
        zernioProfileId: cleanProfileId,
      };
    }

    const found = Array.from(this.memoryUsers.values()).find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    );
    return found || null;
  }

  async findById(id: string): Promise<User | null> {
    const pool = getDbPool();
    if (pool) {
      let result;
      try {
        result = await pool.query(
          'SELECT id, email, password_hash, role, created_at, zernio_profile_id FROM users WHERE id = $1',
          [id]
        );
      } catch {
        // Fallback if migration 004 is not yet applied
        result = await pool.query(
          'SELECT id, email, password_hash, role, created_at FROM users WHERE id = $1',
          [id]
        );
      }
      if (result.rows.length === 0) return null;
      const row = result.rows[0];
      const cachedProfileId = UserRepository.profileCache.get(row.id);
      const cleanProfileId =
        typeof row.zernio_profile_id === 'string' && row.zernio_profile_id.trim()
          ? row.zernio_profile_id.trim()
          : typeof cachedProfileId === 'string' && cachedProfileId.trim()
          ? cachedProfileId.trim()
          : undefined;

      return {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        role: row.role as 'owner' | 'user',
        createdAt: row.created_at,
        zernioProfileId: cleanProfileId,
      };
    }

    return this.memoryUsers.get(id) || null;
  }

  async updateZernioProfileId(userId: string, zernioProfileId: string): Promise<void> {
    if (typeof zernioProfileId !== 'string' || !zernioProfileId.trim()) {
      return;
    }
    const cleanId = zernioProfileId.trim();
    UserRepository.profileCache.set(userId, cleanId);

    const pool = getDbPool();
    if (pool) {
      try {
        await pool.query(
          'UPDATE users SET zernio_profile_id = $1, updated_at = NOW() WHERE id = $2',
          [cleanId, userId]
        );
      } catch (err) {
        console.warn(
          '[UserRepository] Note: zernio_profile_id could not be saved to DB table (migration 004 unapplied). Storing in-memory.'
        );
      }
    }

    const memUser = this.memoryUsers.get(userId);
    if (memUser) {
      memUser.zernioProfileId = cleanId;
    }
  }

  async createUser(email: string, passwordHash: string, role: 'owner' | 'user'): Promise<User> {
    const pool = getDbPool();
    const id = `id_${uuidv4()}`;

    if (pool) {
      const result = await pool.query(
        'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, password_hash, role, created_at',
        [id, email, passwordHash, role]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        email: row.email,
        passwordHash: row.password_hash,
        role: row.role as 'owner' | 'user',
        createdAt: row.created_at,
      };
    }

    const user: User = {
      id,
      email,
      passwordHash,
      role,
      createdAt: new Date().toISOString(),
    };
    this.memoryUsers.set(id, user);
    return user;
  }

  async ownerExists(): Promise<boolean> {
    const pool = getDbPool();
    if (pool) {
      const result = await pool.query(
        "SELECT COUNT(*) as count FROM users WHERE role = 'owner'"
      );
      return parseInt(result.rows[0].count, 10) > 0;
    }

    return Array.from(this.memoryUsers.values()).some((u) => u.role === 'owner');
  }

  async createOwnerWithAssociations(email: string, passwordHash: string): Promise<User> {
    const pool = getDbPool();
    const id = `id_${uuidv4()}`;

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Acquire transaction-scoped advisory lock to serialize concurrent setup attempts.
        // This blocks concurrent setup transactions and releases automatically upon COMMIT or ROLLBACK.
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
          OWNER_SETUP_LOCK_KEY_1,
          OWNER_SETUP_LOCK_KEY_2,
        ]);

        // 2. Check if an owner already exists (with row locking; serialized by advisory lock)
        const ownerCheck = await client.query(
          "SELECT id FROM users WHERE role = 'owner' LIMIT 1 FOR UPDATE"
        );
        if (ownerCheck.rows.length > 0) {
          throw new Error('Owner account already exists.');
        }

        // 3. Check existing social_account row for Facebook account '6ab3ef6b8d284ffb21357563'
        const saCheck = await client.query(
          "SELECT id, platform, account_id, user_id FROM social_accounts WHERE id = $1 FOR UPDATE",
          ['6ab3ef6b8d284ffb21357563']
        );
        if (saCheck.rows.length > 0) {
          const row = saCheck.rows[0];
          if (row.platform !== 'facebook' || row.account_id !== '6ab3ef6b8d284ffb21357563') {
            throw new Error("Conflict: existing social account '6ab3ef6b8d284ffb21357563' has mismatched platform or account_id.");
          }
          if (row.user_id && row.user_id !== id) {
            throw new Error("Conflict: existing social account '6ab3ef6b8d284ffb21357563' is already owned by another user.");
          }
        }

        // 4. Insert owner user
        const result = await client.query(
          'INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, password_hash, role, created_at',
          [id, email, passwordHash, 'owner']
        );
        const userRow = result.rows[0];
        const user: User = {
          id: userRow.id,
          email: userRow.email,
          passwordHash: userRow.password_hash,
          role: userRow.role as 'owner',
          createdAt: userRow.created_at,
        };

        // 5. Assign all legacy posts without user_id to Owner
        await client.query('UPDATE posts SET user_id = $1 WHERE user_id IS NULL', [user.id]);

        // 6. Assign any existing unowned social_accounts to Owner
        await client.query('UPDATE social_accounts SET user_id = $1 WHERE user_id IS NULL', [user.id]);

        // 7. Ensure the owner's Facebook account exists in social_accounts matching migration 001 schema
        const saUpsertRes = await client.query(
          `INSERT INTO social_accounts (id, platform, account_id, display_name, user_id, created_at, updated_at)
           VALUES ('6ab3ef6b8d284ffb21357563', 'facebook', '6ab3ef6b8d284ffb21357563', 'Facebook Page', $1, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             display_name = COALESCE(social_accounts.display_name, EXCLUDED.display_name),
             updated_at = NOW()
           WHERE (social_accounts.user_id IS NULL OR social_accounts.user_id = EXCLUDED.user_id)
             AND social_accounts.platform = 'facebook'
             AND social_accounts.account_id = '6ab3ef6b8d284ffb21357563'
           RETURNING id, platform, account_id, user_id`,
          [user.id]
        );

        if (!saUpsertRes.rows || saUpsertRes.rows.length === 0) {
          throw new Error(
            "Conflict: Facebook account '6ab3ef6b8d284ffb21357563' could not be associated. Account may belong to another user or have mismatched identity."
          );
        }

        const associatedAccount = saUpsertRes.rows[0];
        if (
          associatedAccount.id !== '6ab3ef6b8d284ffb21357563' ||
          associatedAccount.platform !== 'facebook' ||
          associatedAccount.account_id !== '6ab3ef6b8d284ffb21357563' ||
          associatedAccount.user_id !== user.id
        ) {
          throw new Error(
            "Conflict: Facebook account '6ab3ef6b8d284ffb21357563' returned incorrect identity or owner."
          );
        }

        // 8. Assign legacy Facebook post_platforms rows through their owning post
        await client.query(
          `UPDATE post_platforms 
           SET account_id = '6ab3ef6b8d284ffb21357563'
           WHERE platform = 'facebook' AND account_id IS NULL AND post_id IN (
             SELECT id FROM posts WHERE user_id = $1
           )`,
          [user.id]
        );

        await client.query('COMMIT');
        return user;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // In-memory fallback
    if (Array.from(this.memoryUsers.values()).some((u) => u.role === 'owner')) {
      throw new Error('Owner account already exists.');
    }

    const existingSa = this.memoryOwnerAccounts.get('6ab3ef6b8d284ffb21357563');
    if (existingSa) {
      if (existingSa.platform !== 'facebook' || existingSa.accountId !== '6ab3ef6b8d284ffb21357563') {
        throw new Error("Conflict: existing social account '6ab3ef6b8d284ffb21357563' has mismatched platform or account_id.");
      }
      if (existingSa.userId && existingSa.userId !== id) {
        throw new Error("Conflict: existing social account '6ab3ef6b8d284ffb21357563' is already owned by another user.");
      }
    }

    const user: User = {
      id,
      email,
      passwordHash,
      role: 'owner',
      createdAt: new Date().toISOString(),
    };
    this.memoryUsers.set(id, user);
    this.memoryLegacyAssigned = true;
    this.memoryOwnerAccounts.set('6ab3ef6b8d284ffb21357563', {
      id: '6ab3ef6b8d284ffb21357563',
      platform: 'facebook',
      accountId: '6ab3ef6b8d284ffb21357563',
      displayName: 'Facebook Page',
      userId: user.id,
    });

    return user;
  }

  async updateOwnerAccountAssociations(ownerId: string): Promise<void> {
    const pool = getDbPool();
    if (pool) {
      // 1. Assign all legacy posts without user_id to Owner
      await pool.query('UPDATE posts SET user_id = $1 WHERE user_id IS NULL', [ownerId]);

      // 2. Assign any existing unowned social_accounts to Owner
      await pool.query('UPDATE social_accounts SET user_id = $1 WHERE user_id IS NULL', [ownerId]);

      // 3. Ensure the owner's Facebook account exists in social_accounts matching migration 001 schema
      await pool.query(
        `INSERT INTO social_accounts (id, platform, account_id, display_name, user_id, created_at, updated_at)
         VALUES ('6ab3ef6b8d284ffb21357563', 'facebook', '6ab3ef6b8d284ffb21357563', 'Facebook Page', $1, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           display_name = COALESCE(social_accounts.display_name, EXCLUDED.display_name),
           updated_at = NOW()`,
        [ownerId]
      );

      // 4. Assign legacy Facebook post_platforms rows through their owning post
      await pool.query(
        `UPDATE post_platforms 
         SET account_id = '6ab3ef6b8d284ffb21357563'
         WHERE platform = 'facebook' AND account_id IS NULL AND post_id IN (
           SELECT id FROM posts WHERE user_id = $1
         )`,
        [ownerId]
      );
    } else {
      this.memoryLegacyAssigned = true;
      this.memoryOwnerAccounts.set('6ab3ef6b8d284ffb21357563', {
        id: '6ab3ef6b8d284ffb21357563',
        platform: 'facebook',
        accountId: '6ab3ef6b8d284ffb21357563',
        displayName: 'Facebook Page',
        userId: ownerId,
      });
    }
  }

  // Helper for tests to inspect in-memory state
  isLegacyAssignedInMemory(): boolean {
    return this.memoryLegacyAssigned;
  }

  getMemoryOwnerAccount(id: string): any {
    return this.memoryOwnerAccounts.get(id);
  }

  setMemoryOwnerAccount(id: string, account: any): void {
    this.memoryOwnerAccounts.set(id, account);
  }
}
