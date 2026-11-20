export interface ZernioMediaItem {
  type: 'image' | 'video';
  url: string;
}

export interface ZernioPlatformPayload {
  platform: string;
  accountId: string;
  [key: string]: any;
}

export interface ZernioCreatePostPayload {
  content?: string;
  mediaItems?: ZernioMediaItem[];
  platforms: ZernioPlatformPayload[];
  publishNow?: boolean;
  scheduledFor?: string;
  timezone?: string;
}

export interface ZernioPlatformResult {
  platform: string;
  status: 'published' | 'scheduled' | 'failed';
  platformPostId?: string;
  platformPostUrl?: string;
  error?: string;
}

export interface ZernioCreatePostResponse {
  post?: {
    _id?: string;
    status?: string;
    platforms?: ZernioPlatformResult[];
  };
  id?: string;
  postId?: string;
  status?: string;
  platforms?: ZernioPlatformResult[];
  error?: string;
  message?: string;
}

