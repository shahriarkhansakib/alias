import { dbConnect } from "@/lib/db/connect";
import AdminRateLimit from "@/models/AdminRateLimit";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds?: number;
}

export class CommunicationRateLimiter {
  /**
   * Distributed rate limiter backed by MongoDB.
   * Atomic operation per key (e.g. per-user and per-thread).
   */
  static async checkRateLimit(params: {
    key: string;
    maxRequests: number;
    windowSeconds: number;
  }): Promise<RateLimitResult> {
    const { key, maxRequests, windowSeconds } = params;
    await dbConnect();

    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + windowSeconds * 1000);

    try {
      // 1. Try to increment within an active window
      const updated = await AdminRateLimit.findOneAndUpdate(
        {
          key,
          resetAt: { $gt: now },
        },
        {
          $inc: { count: 1 },
        },
        { returnDocument: 'after' }
      );

      if (updated) {
        if (updated.count > maxRequests) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((updated.resetAt.getTime() - now.getTime()) / 1000)
          );
          return {
            allowed: false,
            remaining: 0,
            resetAt: updated.resetAt,
            retryAfterSeconds,
          };
        }

        return {
          allowed: true,
          remaining: Math.max(0, maxRequests - updated.count),
          resetAt: updated.resetAt,
        };
      }

      // 2. Either key doesn't exist or previous window expired: reset atomically
      const resetRecord = await AdminRateLimit.findOneAndUpdate(
        { key },
        {
          $set: {
            count: 1,
            resetAt: windowExpiresAt,
          },
        },
        { upsert: true, returnDocument: 'after' }
      );

      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - 1),
        resetAt: resetRecord.resetAt,
      };
    } catch (err: any) {
      // Handle potential race condition on unique key upsert
      if (err.code === 11000) {
        const existing = await AdminRateLimit.findOne({ key });
        if (existing && existing.resetAt > now) {
          if (existing.count >= maxRequests) {
            return {
              allowed: false,
              remaining: 0,
              resetAt: existing.resetAt,
              retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt.getTime() - now.getTime()) / 1000)),
            };
          }
        }
      }
      // If DB error, fail closed in production, or permit single request
      if (process.env.NODE_ENV === "production") {
        return {
          allowed: false,
          remaining: 0,
          resetAt: windowExpiresAt,
          retryAfterSeconds: 5,
        };
      }
      return { allowed: true, remaining: 1, resetAt: windowExpiresAt };
    }
  }
}
