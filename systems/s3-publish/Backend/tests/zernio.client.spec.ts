import axios from 'axios';
import { ZernioClient } from '../src/social/providers/zernio/zernio.client';
import { SocialPublishingError } from '../src/social/types/publisher.types';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ZernioClient', () => {
  let client: ZernioClient;
  let mockPost: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPost = jest.fn();
    mockedAxios.create.mockReturnValue({
      post: mockPost,
    } as any);

    client = new ZernioClient({
      apiKey: 'test_zernio_key',
      baseUrl: 'https://zernio.com/api/v1',
      maxRetries: 2,
      initialRetryDelayMs: 10,
    });
  });

  test('Test Case 7: Zernio 401 Unauthorized (Does NOT retry)', async () => {
    mockPost.mockRejectedValueOnce({
      response: {
        status: 401,
        data: { message: 'Invalid API Key' },
      },
    });

    await expect(
      client.createPost(
        { platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }] },
        'req_test_123'
      )
    ).rejects.toThrow(SocialPublishingError);

    // Should fail immediately on attempt 1 without retrying
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      '/posts',
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-request-id': 'req_test_123',
          'Authorization': 'Bearer test_zernio_key',
        }),
      })
    );
  });

  test('Test Case 8: Zernio 409 Conflict', async () => {
    mockPost.mockRejectedValueOnce({
      response: {
        status: 409,
        data: { message: 'Duplicate Request ID' },
      },
    });

    await expect(
      client.createPost(
        { platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }] },
        'req_test_dup'
      )
    ).rejects.toThrow('Publishing request conflict');
  });

  test('Test Case 9 & 14: Zernio 429 Rate Limit with Retry and Idempotency preservation', async () => {
    mockPost
      .mockRejectedValueOnce({
        response: { status: 429, data: { message: 'Rate Limit' } },
      })
      .mockResolvedValueOnce({
        data: {
          id: 'zernio_post_999',
          status: 'published',
          platforms: [{ platform: 'facebook', status: 'published' }],
        },
      });

    const result = await client.createPost(
      { platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }] },
      'req_idempotent_429'
    );

    expect(result.status).toBe('published');
    expect(mockPost).toHaveBeenCalledTimes(2);

    // Both calls must carry the SAME idempotency key header
    expect(mockPost.mock.calls[0][2].headers['x-request-id']).toBe('req_idempotent_429');
    expect(mockPost.mock.calls[1][2].headers['x-request-id']).toBe('req_idempotent_429');
  });

  test('Test Case 10: Zernio 503 Provider Error with Retries', async () => {
    mockPost
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockRejectedValueOnce({ response: { status: 503 } });

    await expect(
      client.createPost(
        { platforms: [{ platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' }] },
        'req_503'
      )
    ).rejects.toThrow(SocialPublishingError);

    // 1 initial + 2 retries = 3 calls
    expect(mockPost).toHaveBeenCalledTimes(3);
  });
});
