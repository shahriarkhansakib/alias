export interface ReactionBreakdown {
  like: number;
  love: number;
  haha: number;
  wow: number;
  sad: number;
  angry: number;
}

export interface NormalizedPostMetrics {
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  views: number;
  engagementRate: number;
}

export interface NormalizedTimelinePoint {
  date: string;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  clicks: number;
  views: number;
  engagementRate: number;
}

export interface NormalizedPlatformMetric {
  platform: string;
  status: 'published' | 'not_targeted' | 'failed' | 'scheduled';
  platformPostId?: string;
  platformPostUrl?: string;
  metrics: NormalizedPostMetrics;
}

export interface EngagementActivityItem {
  id: string;
  actorName: string;
  actorType: 'user' | 'audience_snapshot';
  platform: string;
  actionType: 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'comment' | 'click' | 'share';
  reactionLabel: string;
  commentText?: string;
  timestamp: string;
  isAggregatedPrivacyFallback?: boolean;
}

export interface NormalizedPostAnalytics {
  postId: string;
  platform: string;
  platformPostId?: string;
  metrics: NormalizedPostMetrics;
  reactionBreakdown: ReactionBreakdown | null;
  timeline: NormalizedTimelinePoint[];
  fetchedAt: string;
  platformBreakdown?: NormalizedPlatformMetric[];
  engagementActivity?: EngagementActivityItem[];
}

export interface AnalyticsOverviewFilter {
  platform?: string;
  fromDate?: string;
  toDate?: string;
}

export interface NormalizedAnalyticsOverview {
  totalPosts: number;
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
  views: number;
  engagementRate: number;
}

export interface SocialAnalyticsProvider {
  getPostAnalytics(postId: string): Promise<NormalizedPostAnalytics | null>;
  getPostTimeline(postId: string): Promise<NormalizedTimelinePoint[]>;
  getOverview(filter?: AnalyticsOverviewFilter): Promise<NormalizedAnalyticsOverview>;
}
