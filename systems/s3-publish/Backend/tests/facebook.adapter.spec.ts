import { FacebookAdapter } from '../src/social/adapters/facebook.adapter';

describe('FacebookAdapter', () => {
  let adapter: FacebookAdapter;

  beforeEach(() => {
    adapter = new FacebookAdapter();
  });

  test('Test Case 1: Facebook text post payload format', () => {
    const target = { platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' };
    const input = {
      caption: 'Hello Facebook Text Post',
      platforms: [target],
    };

    const formatted = adapter.formatPayload(target, input);
    expect(formatted).toEqual({
      platform: 'facebook',
      accountId: '6ab3ef6b8d284ffb21357563',
    });
  });

  test('Test Case 2: Facebook image post payload format', () => {
    const target = { platform: 'facebook', accountId: '6ab3ef6b8d284ffb21357563' };
    const input = {
      caption: 'Image caption',
      imageUrl: 'https://example.com/image.jpg',
      platforms: [target],
    };

    const formatted = adapter.formatPayload(target, input);
    expect(formatted).toEqual({
      platform: 'facebook',
      accountId: '6ab3ef6b8d284ffb21357563',
    });
  });

  test('Test Case 6: Missing Facebook account ID validation', () => {
    const target = { platform: 'facebook', accountId: '' };
    const input = {
      caption: 'Valid Caption',
      platforms: [target],
    };

    const validation = adapter.validateTarget(target, input);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Facebook accountId is required and cannot be empty.');
  });
});
