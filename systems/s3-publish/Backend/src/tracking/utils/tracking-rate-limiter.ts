import crypto from 'crypto';
import { Request } from 'express';

export interface RateLimiterOptions {
  globalWindowMs?: number;
  globalMax?: number;
  sourceWindowMs?: number;
  sourceMax?: number;
  siteWindowMs?: number;
  siteMax?: number;
  maxEntries?: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  retryAfterSeconds: number;
  limitType?: 'global' | 'source' | 'site';
}

interface WindowBucket {
  count: number;
  resetTime: number;
}

/**
 * In-Memory Layered Rate Limiter for Public Website Tracking Ingestion.
 *
 * ARCHITECTURAL SCOPE & LIMITATIONS:
 * 1. Scope: In-memory store per single Node.js runtime process.
 * 2. Process Lifetime: Counters and buckets reset when the server restarts.
 * 3. Horizontal Scaling: State is NOT shared across multiple server instances or worker clusters.
 *    For distributed production multi-replica deployments, rely on an edge-layer limiter
 *    (e.g., Cloudflare WAF, API Gateway) or centralized store (e.g. Redis).
 * 4. Privacy Guarantee: Zero storage or logging of raw IP addresses or User-Agents.
 *    Client source identifiers are transiently converted into a 32-character keyed HMAC hash
 *    using an ephemeral process startup salt.
 * 5. Bounded Memory: Enforces strict max entry limits with automatic expiration cleanup
 *    and FIFO/LRU eviction to prevent memory exhaustion from spoofed sources.
 */
export class TrackingRateLimiter {
  private readonly salt: string;
  private readonly globalWindowMs: number;
  private readonly globalMax: number;
  private readonly sourceWindowMs: number;
  private readonly sourceMax: number;
  private readonly siteWindowMs: number;
  private readonly siteMax: number;
  private readonly maxEntries: number;

  private globalBucket: WindowBucket;
  private sourceStore: Map<string, WindowBucket>;
  private siteStore: Map<string, WindowBucket>;

  constructor(options: RateLimiterOptions = {}) {
    this.salt = crypto.randomBytes(16).toString('hex');
    this.globalWindowMs = options.globalWindowMs ?? 60 * 1000; // 1 minute
    this.globalMax = options.globalMax ?? 600; // 600 req/min global
    this.sourceWindowMs = options.sourceWindowMs ?? 60 * 1000; // 1 minute
    this.sourceMax = options.sourceMax ?? 60; // 60 req/min per source
    this.siteWindowMs = options.siteWindowMs ?? 60 * 1000; // 1 minute
    this.siteMax = options.siteMax ?? 300; // 300 req/min per site
    this.maxEntries = options.maxEntries ?? 5000;

    this.globalBucket = { count: 0, resetTime: Date.now() + this.globalWindowMs };
    this.sourceStore = new Map();
    this.siteStore = new Map();
  }

  /**
   * Transiently hashes client source IP using keyed HMAC.
   * Never logs, returns, or stores raw IP.
   */
  public hashSource(sourceIp: string): string {
    return crypto
      .createHmac('sha256', this.salt)
      .update(sourceIp || 'unknown_source')
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Evaluates Global and Per-Source rate limits.
   * Applied before JSON parsing or DB work.
   */
  public checkSourceAndGlobal(req: Request): RateLimitCheckResult {
    const now = Date.now();

    // 1. Global limit check
    if (now >= this.globalBucket.resetTime) {
      this.globalBucket = { count: 1, resetTime: now + this.globalWindowMs };
    } else if (this.globalBucket.count >= this.globalMax) {
      const retryAfter = Math.max(1, Math.ceil((this.globalBucket.resetTime - now) / 1000));
      return { allowed: false, retryAfterSeconds: retryAfter, limitType: 'global' };
    } else {
      this.globalBucket.count++;
    }

    // 2. Safe source IP resolution
    // Do not blindly enable trust proxy or trust arbitrary X-Forwarded-For headers from untrusted clients.
    // Express req.ip resolves socket address when trust proxy is false.
    const rawIp = req.socket?.remoteAddress || req.ip || '127.0.0.1';
    const sourceKey = this.hashSource(rawIp);

    // 3. Source limit check
    this.pruneStoreIfNeeded(this.sourceStore);
    const existing = this.sourceStore.get(sourceKey);

    if (!existing || now >= existing.resetTime) {
      this.sourceStore.set(sourceKey, { count: 1, resetTime: now + this.sourceWindowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.sourceMax) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetTime - now) / 1000));
      return { allowed: false, retryAfterSeconds: retryAfter, limitType: 'source' };
    }

    existing.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Evaluates Per-Site rate limit.
   * Applied after siteId is extracted, before database writes.
   */
  public checkSite(siteId: string): RateLimitCheckResult {
    if (!siteId || typeof siteId !== 'string') {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    const now = Date.now();
    this.pruneStoreIfNeeded(this.siteStore);
    const key = siteId.trim();
    const existing = this.siteStore.get(key);

    if (!existing || now >= existing.resetTime) {
      this.siteStore.set(key, { count: 1, resetTime: now + this.siteWindowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.siteMax) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetTime - now) / 1000));
      return { allowed: false, retryAfterSeconds: retryAfter, limitType: 'site' };
    }

    existing.count++;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * Prunes expired keys and enforces strict maximum entry bounds.
   */
  private pruneStoreIfNeeded(store: Map<string, WindowBucket>): void {
    const now = Date.now();
    if (store.size >= this.maxEntries) {
      // First pass: purge expired
      for (const [k, v] of store.entries()) {
        if (now >= v.resetTime) {
          store.delete(k);
        }
      }
      // Second pass: if still full, evict oldest
      while (store.size >= this.maxEntries) {
        const oldestKey = store.keys().next().value;
        if (oldestKey) {
          store.delete(oldestKey);
        } else {
          break;
        }
      }
    }
  }

  /**
   * Resets all internal stores (intended for test environments).
   */
  public reset(): void {
    const now = Date.now();
    this.globalBucket = { count: 0, resetTime: now + this.globalWindowMs };
    this.sourceStore.clear();
    this.siteStore.clear();
  }

  public getStoreSizes(): { sourceCount: number; siteCount: number } {
    return {
      sourceCount: this.sourceStore.size,
      siteCount: this.siteStore.size,
    };
  }
}
