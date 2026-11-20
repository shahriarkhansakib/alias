export interface ProductRecord {
  id: string;
  userId: string;
  name: string;
  destinationUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignRecord {
  id: string;
  userId: string;
  productId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedLinkRecord {
  id: string;
  userId: string;
  campaignId: string;
  productId: string;
  slug: string;
  destinationUrl: string;
  label?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedClickRecord {
  id: string;
  linkId: string;
  campaignId: string;
  productId: string;
  userId: string;
  isBot: boolean;
  createdAt: string;
}

export interface TrackingBaseUrlInfo {
  baseUrl: string;
  isConfigured: boolean;
  isHttps: boolean;
  isLocalhost: boolean;
  warning?: string;
}

export interface TrackingStatsLinkItem {
  id: string;
  slug: string;
  trackedUrl: string;
  label?: string;
  destinationUrl: string;
  eligibleClicks: number;
  createdAt: string;
}

export interface TrackingStatsCampaignItem {
  id: string;
  name: string;
  eligibleClicks: number;
  links: TrackingStatsLinkItem[];
}

export interface TrackingStatsProductItem {
  id: string;
  name: string;
  destinationUrl: string;
  eligibleClicks: number;
  campaigns: TrackingStatsCampaignItem[];
}

export interface TrackingStatsResult {
  metricLabel: string;
  totalEligibleClicks: number;
  config: TrackingBaseUrlInfo;
  products: TrackingStatsProductItem[];
}

// --- Phase 2: Website Activity Tracking Types ---

export interface TrackingWebsiteRecord {
  id: string;
  userId: string;
  siteId: string;
  name: string;
  origin: string;
  createdAt: string;
  updatedAt: string;
}

export type WebsiteEventName = 'page_view' | 'product_click';

export interface TrackingWebsiteEventRecord {
  id: string;
  websiteId: string;
  userId: string;
  eventName: WebsiteEventName;
  eventId: string;
  productId?: string;
  isBot: boolean;
  createdAt: string;
}

export interface WebsiteStatsProductItem {
  id: string;
  name: string;
  destinationUrl: string;
  productClicks: number;
  trackAttribute: string;
}

export interface WebsiteStatsResult {
  metricLabel: string;
  website: TrackingWebsiteRecord | null;
  websites: TrackingWebsiteRecord[];
  snippet: string;
  installationPending: boolean;
  totalPageViews: number;
  totalProductClicks: number;
  products: WebsiteStatsProductItem[];
  warning?: string;
  isLocalhost: boolean;
  baseUrl: string;
}

