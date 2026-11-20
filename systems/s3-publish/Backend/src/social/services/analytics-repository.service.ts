import {
  NormalizedPostAnalytics,
  NormalizedTimelinePoint,
  NormalizedAnalyticsOverview,
} from '../types/analytics.types';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class AnalyticsRepositoryService {
  private postAnalyticsCache = new Map<string, CacheEntry<NormalizedPostAnalytics>>();
  private timelineCache = new Map<string, CacheEntry<NormalizedTimelinePoint[]>>();
  private overviewCache = new Map<string, CacheEntry<NormalizedAnalyticsOverview>>();
  private defaultTtlMs: number;

  constructor(defaultTtlSeconds: number = 300) {
    this.defaultTtlMs = defaultTtlSeconds * 1000;
  }

  public getPostAnalytics(postId: string): NormalizedPostAnalytics | null {
    const entry = this.postAnalyticsCache.get(postId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.postAnalyticsCache.delete(postId);
      return null;
    }
    return entry.data;
  }

  public setPostAnalytics(postId: string, data: NormalizedPostAnalytics, ttlSeconds?: number): void {
    const ttl = (ttlSeconds ?? this.defaultTtlMs / 1000) * 1000;
    this.postAnalyticsCache.set(postId, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  public getTimeline(postId: string): NormalizedTimelinePoint[] | null {
    const entry = this.timelineCache.get(postId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.timelineCache.delete(postId);
      return null;
    }
    return entry.data;
  }

  public setTimeline(postId: string, data: NormalizedTimelinePoint[], ttlSeconds?: number): void {
    const ttl = (ttlSeconds ?? this.defaultTtlMs / 1000) * 1000;
    this.timelineCache.set(postId, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  public getOverview(filterKey: string): NormalizedAnalyticsOverview | null {
    const entry = this.overviewCache.get(filterKey);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.overviewCache.delete(filterKey);
      return null;
    }
    return entry.data;
  }

  public setOverview(filterKey: string, data: NormalizedAnalyticsOverview, ttlSeconds?: number): void {
    const ttl = (ttlSeconds ?? this.defaultTtlMs / 1000) * 1000;
    this.overviewCache.set(filterKey, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  public clear(): void {
    this.postAnalyticsCache.clear();
    this.timelineCache.clear();
    this.overviewCache.clear();
  }
}
