import axios, {
  AxiosInstance,
  AxiosError,
  AxiosRequestConfig,
} from 'axios';

import { config } from '../../../config/env';

import {
  SocialPublishingError,
} from '../../types/publisher.types';

import {
  ZernioCreatePostPayload,
  ZernioCreatePostResponse,
} from './zernio.types';

export interface ZernioClientOptions {
  apiKey?: string;
  baseUrl?: string;
  maxRetries?: number;
  initialRetryDelayMs?: number;
}

export class ZernioClient {
  private client: AxiosInstance;
  private apiKey: string;
  private maxRetries: number;
  private initialRetryDelayMs: number;

  constructor(
    options: ZernioClientOptions = {}
  ) {
    this.apiKey =
      options.apiKey || '';

    const baseUrl = (
      options.baseUrl ||
      config.zernioBaseUrl ||
      'https://zernio.com/api/v1'
    ).replace(/\/+$/, '');

    this.maxRetries =
      options.maxRetries ?? 3;

    this.initialRetryDelayMs =
      options.initialRetryDelayMs ?? 200;

    this.client =
      axios.create({
        baseURL: baseUrl,
        timeout: 10000,
        headers: {
          'Content-Type':
            'application/json',
        },
      });
  }

  public setApiKey(
    key: string
  ): void {
    this.apiKey = key;
  }

  private shouldRetry(
    error: AxiosError
  ): boolean {
    if (!error.response) {
      return true;
    }

    const status =
      error.response.status;

    return (
      status === 429 ||
      status === 502 ||
      status === 503 ||
      status === 504
    );
  }

  private async sleep(
    ms: number
  ): Promise<void> {
    return new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          ms
        )
    );
  }

  public getApiKey(): string {
    return (
      this.apiKey ||
      config.zernioApiKey ||
      process.env
        .ZERNIO_API_KEY ||
      ''
    );
  }

  public async verifyAuth(): Promise<{
    valid: boolean;
    authType?: string;
    error?: string;
  }> {
    const apiKey =
      this.getApiKey();

    if (!apiKey) {
      return {
        valid: false,
        error:
          'ZERNIO_API_KEY environment variable is missing.',
      };
    }

    try {
      const response =
        await this.client.get(
          '/auth/verify',
          {
            headers: {
              Authorization:
                `Bearer ${apiKey}`,
            },
          }
        );

      return response.data;
    } catch (err: any) {
      return {
        valid: false,
        error:
          err.response?.data
            ?.message ||
          err.message ||
          'Auth verification failed',
      };
    }
  }

  public async getAnalytics(
    params?: {
      page?: number;
      limit?: number;
      search?: string;
    }
  ): Promise<any> {
    const apiKey =
      this.getApiKey();

    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    try {
      const response =
        await this.client.get(
          '/analytics',
          {
            headers: {
              Authorization:
                `Bearer ${apiKey}`,
            },
            params: {
              limit:
                params?.limit ?? 100,
              ...(params?.page
                ? {
                    page:
                      params.page,
                  }
                : {}),
              ...(params?.search
                ? {
                    search:
                      params.search,
                  }
                : {}),
            },
          }
        );

      return response.data;
    } catch (err: any) {
      throw new SocialPublishingError(
        err.response?.data
          ?.message ||
          err.message ||
          'Failed to fetch Zernio analytics',
        err.response?.status ||
          500
      );
    }
  }

  public async getPostTimeline(
    postId: string
  ): Promise<any> {
    const apiKey =
      this.getApiKey();

    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    try {
      const response =
        await this.client.get(
          '/analytics/post-timeline',
          {
            headers: {
              Authorization:
                `Bearer ${apiKey}`,
            },
            params: {
              postId,
            },
          }
        );

      return response.data;
    } catch (err: any) {
      throw new SocialPublishingError(
        err.response?.data
          ?.message ||
          err.message ||
          'Failed to fetch Zernio post timeline',
        err.response?.status ||
          500
      );
    }
  }

  public async getDailyMetrics(
    params?: {
      fromDate?: string;
      toDate?: string;
      platform?: string;
    }
  ): Promise<any> {
    const apiKey =
      this.getApiKey();

    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    try {
      const response =
        await this.client.get(
          '/analytics/daily-metrics',
          {
            headers: {
              Authorization:
                `Bearer ${apiKey}`,
            },
            params,
          }
        );

      return response.data;
    } catch (err: any) {
      throw new SocialPublishingError(
        err.response?.data
          ?.message ||
          err.message ||
          'Failed to fetch Zernio daily metrics',
        err.response?.status ||
          500
      );
    }
  }

  public async createPost(
    payload: ZernioCreatePostPayload,
    idempotencyKey: string
  ): Promise<ZernioCreatePostResponse> {
    const apiKey =
      this.getApiKey();

    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    const reqConfig:
      AxiosRequestConfig = {
      headers: {
        Authorization:
          `Bearer ${apiKey}`,
        'x-request-id':
          idempotencyKey,
      },
    };

    let attempt = 0;

    while (
      attempt <= this.maxRetries
    ) {
      try {
        const response =
          await this.client.post<ZernioCreatePostResponse>(
            '/posts',
            payload,
            reqConfig
          );

        console.log(
          '[ZernioClient] CREATE POST RESPONSE:',
          JSON.stringify(
            response.data,
            null,
            2
          )
        );

        return response.data;
      } catch (err: any) {
        const axiosError =
          err as AxiosError<any>;

        const isRetryable =
          this.shouldRetry(
            axiosError
          );

        const status =
          axiosError.response
            ?.status;

        const responseData =
          axiosError.response
            ?.data;

        const safeErrorLog = {
          endpoint: '/posts',
          attempt:
            attempt + 1,
          status:
            status ||
            'NETWORK_ERROR',
          idempotencyKey,
          message:
            axiosError.message,
          errorData:
            responseData,
        };

        console.warn(
          `[ZernioClient] API Request failed (Attempt ${
            attempt + 1
          }/${this.maxRetries + 1}):`,
          JSON.stringify(
            safeErrorLog
          )
        );

        if (
          isRetryable &&
          attempt <
            this.maxRetries
        ) {
          attempt++;

          const delay =
            Math.pow(
              2,
              attempt
            ) *
              this.initialRetryDelayMs +
            Math.random() * 50;

          await this.sleep(
            delay
          );

          continue;
        }

        const errorMessage =
          responseData?.message ||
          responseData?.error ||
          axiosError.message ||
          'Zernio API request failed';

        if (
          status === 400
        ) {
          const validationMsg =
            responseData?.error ||
            responseData?.message ||
            'Zernio rejected publishing request (Validation Error).';

          throw new SocialPublishingError(
            validationMsg,
            400,
            {
              status,
              providerError:
                responseData,
            }
          );
        }

        if (
          status === 401
        ) {
          throw new SocialPublishingError(
            'Zernio authorization failed. Invalid or expired API key.',
            401,
            {
              status,
              providerError:
                responseData,
            }
          );
        }

        if (
          status === 409
        ) {
          const rawDetail =
            responseData?.error ||
            responseData?.message;
          const conflictMsg = rawDetail
            ? `Publishing request conflict: ${rawDetail}`
            : 'Publishing request conflict. Idempotency key or duplicate request detected.';

          throw new SocialPublishingError(
            conflictMsg,
            409,
            {
              status,
              providerError:
                responseData,
            }
          );
        }

        if (
          status === 429
        ) {
          throw new SocialPublishingError(
            'Zernio rate limit exceeded. Please try again later.',
            429,
            {
              status,
              providerError:
                responseData,
            }
          );
        }

        if (
          status &&
          status >= 500
        ) {
          throw new SocialPublishingError(
            `Zernio provider error (${status}).`,
            503,
            {
              status,
              providerError:
                responseData,
            }
          );
        }

        throw new SocialPublishingError(
          errorMessage,
          status || 500,
          {
            status,
            providerError:
              responseData,
          }
        );
      }
    }

    throw new SocialPublishingError(
      'Maximum retry attempts exceeded for Zernio API call.',
      503
    );
  }

  public async createProfile(data: { name: string; externalId?: string }): Promise<any> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    try {
      const response = await this.client.post('/profiles', data, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;
      const responseData = err.response?.data;
      const message =
        responseData?.message ||
        responseData?.error ||
        err.message ||
        'Failed to create Zernio profile';
      throw new SocialPublishingError(message, status || 500, {
        status,
        providerError: responseData,
        details: responseData?.details,
      });
    }
  }

  public async getProfiles(params?: { externalId?: string }): Promise<any> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    try {
      const response = await this.client.get('/profiles', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        params: {
          ...(params?.externalId ? { externalId: params.externalId } : {}),
        },
      });
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;
      const responseData = err.response?.data;
      const message =
        responseData?.message ||
        responseData?.error ||
        err.message ||
        'Failed to fetch Zernio profiles';
      throw new SocialPublishingError(message, status || 500, {
        status,
        providerError: responseData,
      });
    }
  }

  public async getProfile(profileId: string): Promise<any> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    try {
      const response = await this.client.get(`/profiles/${profileId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;
      const responseData = err.response?.data;
      const message =
        responseData?.message ||
        responseData?.error ||
        err.message ||
        `Failed to fetch Zernio profile '${profileId}'`;
      throw new SocialPublishingError(message, status || 500, {
        status,
        providerError: responseData,
      });
    }
  }

  public async getConnectUrl(
    platform: string,
    params: { profileId: string; redirect_url: string }
  ): Promise<{ authUrl: string }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    const normPlatform = (platform || '').toLowerCase().trim();
    const platformSlug = normPlatform === 'x' ? 'twitter' : normPlatform;

    if (!params?.profileId || typeof params.profileId !== 'string' || !params.profileId.trim()) {
      throw new SocialPublishingError(
        'profileId is required to generate connect URL',
        400
      );
    }

    try {
      const response = await this.client.get(`/connect/${platformSlug}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        params: {
          profileId: params.profileId,
          redirect_url: params.redirect_url,
        },
      });
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;
      const responseData = err.response?.data;
      const message =
        responseData?.message ||
        responseData?.error ||
        err.message ||
        `Failed to get connect URL for ${platform}`;
      throw new SocialPublishingError(message, status || 500, {
        status,
        providerError: responseData,
      });
    }
  }

  public async listAccounts(params?: {
    profileId?: string;
    platform?: string;
  }): Promise<any> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    try {
      const response = await this.client.get('/accounts', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        params: {
          ...(params?.profileId ? { profileId: params.profileId } : {}),
          ...(params?.platform ? { platform: params.platform } : {}),
        },
      });
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;
      const responseData = err.response?.data;
      const message =
        responseData?.message ||
        responseData?.error ||
        err.message ||
        'Failed to list Zernio accounts';
      throw new SocialPublishingError(message, status || 500, {
        status,
        providerError: responseData,
      });
    }
  }

  public async deleteAccount(accountId: string): Promise<any> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new SocialPublishingError(
        'accountId is required to disconnect account',
        400
      );
    }

    try {
      const response = await this.client.delete(`/accounts/${accountId.trim()}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;
      const responseData = err.response?.data;
      const message =
        responseData?.message ||
        responseData?.error ||
        err.message ||
        `Failed to disconnect Zernio account '${accountId}'`;
      throw new SocialPublishingError(message, status || 500, {
        status,
        providerError: responseData,
      });
    }
  }

  public async getFacebookPostReactions(
    accountId: string,
    postId: string
  ): Promise<any> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new SocialPublishingError('accountId is required to fetch post reactions', 400);
    }

    if (!postId || typeof postId !== 'string' || !postId.trim()) {
      throw new SocialPublishingError('postId is required to fetch post reactions', 400);
    }

    try {
      const response = await this.client.get(
        `/accounts/${encodeURIComponent(accountId.trim())}/facebook-post-reactions`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          params: {
            postId: postId.trim(),
          },
        }
      );
      return response.data;
    } catch (err: any) {
      const status = err.response?.status;
      const responseData = err.response?.data;
      const message =
        responseData?.message ||
        responseData?.error ||
        err.message ||
        `Failed to fetch Facebook post reactions for post '${postId}'`;
      throw new SocialPublishingError(message, status || 500, {
        status,
        providerError: responseData,
      });
    }
  }

  public async getPostComments(
    postId: string,
    accountId: string,
    cursor?: string,
    limit: number = 25
  ): Promise<{ comments: any[]; pagination: { hasMore: boolean; nextCursor: string | null } }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new SocialPublishingError(
        'Zernio API key is missing. Check ZERNIO_API_KEY environment variable.',
        401
      );
    }

    if (!postId || typeof postId !== 'string' || !postId.trim()) {
      throw new SocialPublishingError('postId is required to fetch comments', 400);
    }

    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new SocialPublishingError('accountId is required to fetch comments', 400);
    }

    try {
      const params: Record<string, any> = {
        accountId: accountId.trim(),
        limit,
      };
      if (cursor && typeof cursor === 'string' && cursor.trim()) {
        params.cursor = cursor.trim();
      }

      const response = await this.client.get(`/inbox/comments/${encodeURIComponent(postId.trim())}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        params,
      });

      const body = response.data || {};
      const comments = Array.isArray(body.data)
        ? body.data
        : Array.isArray(body.comments)
          ? body.comments
          : Array.isArray(body)
            ? body
            : [];

      const hasMore = Boolean(body.pagination?.hasMore ?? body.hasMore ?? false);
      const nextCursor =
        body.pagination?.nextCursor ||
        body.pagination?.cursor ||
        body.nextCursor ||
        null;

      return {
        comments,
        pagination: {
          hasMore,
          nextCursor: typeof nextCursor === 'string' ? nextCursor : null,
        },
      };
    } catch (err: any) {
      const status = err.response?.status;
      const responseData = err.response?.data;
      const message =
        responseData?.message ||
        responseData?.error ||
        err.message ||
        `Failed to fetch comments for post '${postId}'`;
      throw new SocialPublishingError(message, status || 500, {
        status,
        providerError: responseData,
      });
    }
  }
}



// import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';
// import { config } from '../../../config/env';
// import { SocialPublishingError } from '../../types/publisher.types';
// import { ZernioCreatePostPayload, ZernioCreatePostResponse } from './zernio.types';

// export interface ZernioClientOptions {
//   apiKey?: string;
//   baseUrl?: string;
//   maxRetries?: number;
//   initialRetryDelayMs?: number;
// }

// export class ZernioClient {
//   private client: AxiosInstance;
//   private apiKey: string;
//   private maxRetries: number;
//   private initialRetryDelayMs: number;

//   constructor(options: ZernioClientOptions = {}) {
//     this.apiKey = options.apiKey || '';
//     const baseUrl = (options.baseUrl || config.zernioBaseUrl || 'https://zernio.com/api/v1').replace(/\/+$/, '');
//     this.maxRetries = options.maxRetries ?? 3;
//     this.initialRetryDelayMs = options.initialRetryDelayMs ?? 200;

//     this.client = axios.create({
//       baseURL: baseUrl,
//       timeout: 10000,
//       headers: {
//         'Content-Type': 'application/json',
//       },
//     });
//   }

//   public setApiKey(key: string): void {
//     this.apiKey = key;
//   }

//   private shouldRetry(error: AxiosError): boolean {
//     if (!error.response) {
//       // Network timeout or connectivity failure -> transient, retry!
//       return true;
//     }
//     const status = error.response.status;
//     // Retry rate limits (429) and server errors (502, 503, 504)
//     return status === 429 || status === 502 || status === 503 || status === 504;
//   }

//   private async sleep(ms: number): Promise<void> {
//     return new Promise((resolve) => setTimeout(resolve, ms));
//   }

//   private maskSecret(str?: string): string {
//     if (!str) return '[REDACTED]';
//     return '[REDACTED_SECRET]';
//   }

//   public getApiKey(): string {
//     return this.apiKey || config.zernioApiKey || process.env.ZERNIO_API_KEY || '';
//   }

//   public async verifyAuth(): Promise<{ valid: boolean; authType?: string; error?: string }> {
//     const apiKey = this.getApiKey();
//     if (!apiKey) {
//       return { valid: false, error: 'ZERNIO_API_KEY environment variable is missing.' };
//     }
//     try {
//       const response = await this.client.get('/auth/verify', {
//         headers: {
//           'Authorization': `Bearer ${apiKey}`,
//         },
//       });
//       return response.data;
//     } catch (err: any) {
//       return {
//         valid: false,
//         error: err.response?.data?.message || err.message || 'Auth verification failed',
//       };
//     }
//   }

//   public async getAnalytics(params?: { page?: number; limit?: number; search?: string }): Promise<any> {
//     const apiKey = this.getApiKey();
//     if (!apiKey) {
//       throw new SocialPublishingError('Zernio API key is missing. Check ZERNIO_API_KEY environment variable.', 401);
//     }
//     try {
//       const response = await this.client.get('/analytics', {
//         headers: { Authorization: `Bearer ${apiKey}` },
//         params,
//       });
//       return response.data;
//     } catch (err: any) {
//       throw new SocialPublishingError(
//         err.response?.data?.message || err.message || 'Failed to fetch Zernio analytics',
//         err.response?.status || 500
//       );
//     }
//   }

//   public async getPostTimeline(postId: string): Promise<any> {
//     const apiKey = this.getApiKey();
//     if (!apiKey) {
//       throw new SocialPublishingError('Zernio API key is missing. Check ZERNIO_API_KEY environment variable.', 401);
//     }
//     try {
//       const response = await this.client.get('/analytics/post-timeline', {
//         headers: { Authorization: `Bearer ${apiKey}` },
//         params: { postId },
//       });
//       return response.data;
//     } catch (err: any) {
//       throw new SocialPublishingError(
//         err.response?.data?.message || err.message || 'Failed to fetch Zernio post timeline',
//         err.response?.status || 500
//       );
//     }
//   }

//   public async getDailyMetrics(params?: { fromDate?: string; toDate?: string; platform?: string }): Promise<any> {
//     const apiKey = this.getApiKey();
//     if (!apiKey) {
//       throw new SocialPublishingError('Zernio API key is missing. Check ZERNIO_API_KEY environment variable.', 401);
//     }
//     try {
//       const response = await this.client.get('/analytics/daily-metrics', {
//         headers: { Authorization: `Bearer ${apiKey}` },
//         params,
//       });
//       return response.data;
//     } catch (err: any) {
//       throw new SocialPublishingError(
//         err.response?.data?.message || err.message || 'Failed to fetch Zernio daily metrics',
//         err.response?.status || 500
//       );
//     }
//   }

//   public async createPost(
//     payload: ZernioCreatePostPayload,
//     idempotencyKey: string
//   ): Promise<ZernioCreatePostResponse> {
//     const apiKey = this.getApiKey();
//     if (!apiKey) {
//       throw new SocialPublishingError('Zernio API key is missing. Check ZERNIO_API_KEY environment variable.', 401);
//     }

//     const reqConfig: AxiosRequestConfig = {
//       headers: {
//         'Authorization': `Bearer ${apiKey}`,
//         'x-request-id': idempotencyKey,
//       },
//     };

//     let attempt = 0;
//     while (attempt <= this.maxRetries) {
//       try {
//         const response = await this.client.post<ZernioCreatePostResponse>('/posts', payload, reqConfig);
//         console.log('[ZernioClient] CREATE POST RESPONSE:', JSON.stringify(response.data, null, 2));
//         return response.data;
//       } catch (err: any) {
//         const axiosError = err as AxiosError<any>;
        
//         const isRetryable = this.shouldRetry(axiosError);
//         const status = axiosError.response?.status;
//         const responseData = axiosError.response?.data;

//         // Log diagnostic information without leaking secrets
//         const safeErrorLog = {
//           endpoint: '/posts',
//           attempt: attempt + 1,
//           status: status || 'NETWORK_ERROR',
//           idempotencyKey,
//           message: axiosError.message,
//           errorData: responseData,
//         };
//         console.warn(`[ZernioClient] API Request failed (Attempt ${attempt + 1}/${this.maxRetries + 1}):`, JSON.stringify(safeErrorLog));

//         if (isRetryable && attempt < this.maxRetries) {
//           attempt++;
//           // Exponential backoff with jitter
//           const delay = Math.pow(2, attempt) * this.initialRetryDelayMs + Math.random() * 50;
//           await this.sleep(delay);
//           continue;
//         }

//         // Map status codes to safe normalized SocialPublishingError
//         const errorMessage = responseData?.message || responseData?.error || axiosError.message || 'Zernio API request failed';
        
//         if (status === 401) {
//           throw new SocialPublishingError('Zernio authorization failed. Invalid or expired API key.', 401, { status, providerError: responseData });
//         } else if (status === 409) {
//           throw new SocialPublishingError('Publishing request conflict. Idempotency key or duplicate request detected.', 409, { status, providerError: responseData });
//         } else if (status === 429) {
//           throw new SocialPublishingError('Zernio rate limit exceeded. Please try again later.', 429, { status, providerError: responseData });
//         } else if (status && status >= 500) {
//           throw new SocialPublishingError(`Zernio provider error (${status}).`, 503, { status, providerError: responseData });
//         } else {
//           throw new SocialPublishingError(errorMessage, status || 500, { status, providerError: responseData });
//         }
//       }
//     }

//     throw new SocialPublishingError('Maximum retry attempts exceeded for Zernio API call.', 503);
//   }
// }

