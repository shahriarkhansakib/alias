export interface TargetPlatform {
  platform: string;
  accountId: string;
}

export interface PublishPostInput {
  caption?: string;
  imageUrl?: string;
  platforms: TargetPlatform[];
  publishNow?: boolean;
  scheduledFor?: string;
  scheduledAt?: string;
  timezone?: string;
  idempotencyKey?: string;
}

export interface PlatformPublishResult {
  platform: string;
  status: 'published' | 'scheduled' | 'failed';
  platformPostId?: string;
  platformPostUrl?: string;
  accountId?: string;
  error?: string;
}

export interface NormalizedPublishResult {
  success: boolean;
  postId: string;
  status: 'published' | 'scheduled' | 'failed' | 'partial';
  platforms: PlatformPublishResult[];
  error?: string;
}

export interface PostRecord {
  internalPostId: string;
  userId?: string;
  providerPostId?: string;
  idempotencyKey: string;
  caption?: string;
  imageUrl?: string;
  publishNow: boolean;
  scheduledFor?: string;
  timezone?: string;
  status: 'published' | 'scheduled' | 'failed' | 'partial';
  platforms: PlatformPublishResult[];
  createdAt: string;
  updatedAt: string;
}

export class SocialPublishingError extends Error {
  public statusCode: number;
  public details?: any;

  constructor(message: string, statusCode = 400, details?: any) {
    super(message);
    this.name = 'SocialPublishingError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
