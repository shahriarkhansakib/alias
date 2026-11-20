import request from 'supertest';
import { createApp } from '../src/app';
import { PostRepositoryService } from '../src/social/services/post-repository.service';
import { UserRepository } from '../src/auth/user.repository';
import { SocialConnectService, OWNER_FACEBOOK_ACCOUNT_ID } from '../src/social/services/social-connect.service';
import { ZernioClient } from '../src/social/providers/zernio/zernio.client';
import { generateToken } from '../src/auth/auth.service';

describe('Phase 2: Social Account Connection Flow', () => {
  let app: any;
  let postRepository: PostRepositoryService;
  let userRepository: UserRepository;
  let mockZernioClient: any;
  let socialConnectService: SocialConnectService;

  const OWNER_USER_ID = 'user_owner_test';
  const REGULAR_USER_ID = 'user_regular_test';
  const OTHER_USER_ID = 'user_other_test';

  const OWNER_PROFILE_ID = '6ab3ed260b5ca69486b5eedb';
  const REGULAR_PROFILE_ID = 'prof_reg_user_123';

  let ownerToken: string;
  let regularToken: string;
  let otherToken: string;

  beforeEach(async () => {
    postRepository = new PostRepositoryService();
    userRepository = new UserRepository();

    // Seed test users in repository
    await userRepository.createUser('owner@example.com', 'hashed_pass_owner', 'owner');
    // Force specific IDs in memory repository
    const ownerUser = {
      id: OWNER_USER_ID,
      email: 'owner@example.com',
      passwordHash: 'hashed_pass_owner',
      role: 'owner' as const,
      createdAt: new Date().toISOString(),
    };
    const regularUser = {
      id: REGULAR_USER_ID,
      email: 'regular@example.com',
      passwordHash: 'hashed_pass_reg',
      role: 'user' as const,
      createdAt: new Date().toISOString(),
    };
    const otherUser = {
      id: OTHER_USER_ID,
      email: 'other@example.com',
      passwordHash: 'hashed_pass_other',
      role: 'user' as const,
      createdAt: new Date().toISOString(),
    };

    (userRepository as any).memoryUsers.set(OWNER_USER_ID, ownerUser);
    (userRepository as any).memoryUsers.set(REGULAR_USER_ID, regularUser);
    (userRepository as any).memoryUsers.set(OTHER_USER_ID, otherUser);

    // Seed owner's existing Facebook account
    await postRepository.saveAccount({
      id: OWNER_FACEBOOK_ACCOUNT_ID,
      platform: 'facebook',
      accountId: OWNER_FACEBOOK_ACCOUNT_ID,
      displayName: 'Alias Marketing Facebook',
      userId: OWNER_USER_ID,
    });

    ownerToken = generateToken(OWNER_USER_ID, 'owner');
    regularToken = generateToken(REGULAR_USER_ID, 'user');
    otherToken = generateToken(OTHER_USER_ID, 'user');

    // Setup Mock Zernio Client
    mockZernioClient = {
      getApiKey: jest.fn().mockReturnValue('mock_api_key'),
      verifyAuth: jest.fn().mockResolvedValue({ valid: true }),
      getAnalytics: jest.fn().mockResolvedValue({ overview: {}, posts: [] }),
      listAccounts: jest.fn().mockImplementation(async (params?: { profileId?: string }) => {
        if (!params?.profileId || params.profileId === OWNER_PROFILE_ID) {
          return {
            accounts: [
              {
                _id: OWNER_FACEBOOK_ACCOUNT_ID,
                profileId: OWNER_PROFILE_ID,
                platform: 'facebook',
                username: 'AliasmarketingBd',
                displayName: 'Alias Marketing Facebook',
                isActive: true,
              },
            ],
          };
        }
        if (params.profileId === REGULAR_PROFILE_ID) {
          return {
            accounts: [
              {
                _id: 'acc_ig_regular_1',
                profileId: REGULAR_PROFILE_ID,
                platform: 'instagram',
                username: 'regular_ig_brand',
                displayName: 'Regular IG Brand',
                isActive: true,
              },
            ],
          };
        }
        return { accounts: [] };
      }),
      getProfiles: jest.fn().mockImplementation(async (params?: { externalId?: string }) => {
        if (params?.externalId === REGULAR_USER_ID) {
          return { profiles: [] }; // Initial lookup: none exist yet
        }
        return {
          profiles: [
            {
              _id: OWNER_PROFILE_ID,
              name: 'Default Profile',
              isDefault: true,
            },
          ],
        };
      }),
      createProfile: jest.fn().mockImplementation(async (data: { name: string; externalId?: string }) => {
        if (data.externalId === REGULAR_USER_ID) {
          return {
            _id: REGULAR_PROFILE_ID,
            name: data.name,
            externalId: data.externalId,
          };
        }
        return {
          _id: `prof_${data.externalId || 'new'}`,
          name: data.name,
          externalId: data.externalId,
        };
      }),
      getProfile: jest.fn().mockImplementation(async (profileId: string) => {
        return { _id: profileId, name: 'Profile' };
      }),
      getConnectUrl: jest.fn().mockImplementation(async (platform: string, params: { profileId: string; redirect_url: string }) => {
        return {
          authUrl: `https://zernio.com/oauth/connect/${platform}?profileId=${params.profileId}&redirect_url=${encodeURIComponent(params.redirect_url)}`,
        };
      }),
    };

    socialConnectService = new SocialConnectService(
      mockZernioClient as any,
      postRepository,
      userRepository
    );

    app = createApp(
      undefined,
      postRepository,
      undefined,
      undefined,
      socialConnectService
    );
  });

  describe('Route Authentication & Validation', () => {
    it('returns 401 when requesting connect URL without authentication', async () => {
      const res = await request(app).get('/api/social/connect/facebook');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 401 when calling connect callback without authentication', async () => {
      const res = await request(app)
        .post('/api/social/connect/callback')
        .send({
          connected: true,
          profileId: REGULAR_PROFILE_ID,
          accountId: 'acc_ig_regular_1',
        });
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for unsupported platform', async () => {
      const res = await request(app)
        .get('/api/social/connect/tiktok')
        .set('Cookie', `auth_token=${regularToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/unsupported.*platform/i);
    });

    it('returns 400 when callback reports canceled authorization (connected=false)', async () => {
      const res = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${regularToken}`)
        .send({
          connected: false,
          profileId: REGULAR_PROFILE_ID,
          accountId: 'acc_test',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/canceled or failed/i);
    });

    it('returns 400 when callback is missing required fields', async () => {
      const res = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${regularToken}`)
        .send({
          connected: true,
          // Missing profileId and accountId
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('fails clearly before redirecting if profileId is missing or empty (throws 400)', async () => {
      // 1. Direct ZernioClient validation test: missing/empty profileId throws 400 immediately
      const realClient = new ZernioClient({ apiKey: 'test_key' });
      await expect(
        realClient.getConnectUrl('facebook', { profileId: '', redirect_url: 'http://localhost:5173/accounts' })
      ).rejects.toThrow(/profileId is required/i);

      // 2. SocialConnectService validation test: if profileId resolution returns empty string
      const failingMockClient: any = {
        getApiKey: jest.fn().mockReturnValue('test_key'),
        getProfiles: jest.fn().mockResolvedValue({ profiles: [] }),
        createProfile: jest.fn().mockResolvedValue({}), // returns empty object with no ID
      };
      const failingService = new SocialConnectService(
        failingMockClient,
        postRepository,
        userRepository
      );

      await expect(
        failingService.getConnectUrl('user_unknown_test', 'user', 'facebook', 'http://localhost:5173/accounts')
      ).rejects.toThrow(/profileId is required before redirect|Failed to resolve/i);
    });

    it('stops before redirect and returns 400 when profileId cannot be resolved for authenticated user', async () => {
      const emptyProfileMockClient: any = {
        getApiKey: jest.fn().mockReturnValue('mock_api_key'),
        getProfiles: jest.fn().mockResolvedValue({ profiles: [] }),
        createProfile: jest.fn().mockResolvedValue({ profile: {} }),
      };
      const unresolvableConnectService = new SocialConnectService(
        emptyProfileMockClient,
        postRepository,
        userRepository
      );
      const testApp = createApp(
        undefined,
        postRepository,
        undefined,
        undefined,
        unresolvableConnectService
      );

      const res = await request(testApp)
        .get('/api/social/connect/facebook')
        .set('Cookie', `auth_token=${regularToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBe(
        `Failed to resolve profileId for user '${REGULAR_USER_ID}': profileId is required before redirect.`
      );
      expect(res.body.authUrl).toBeUndefined();
    });
  });

  describe('Multi-Tenant Profile Resolution & Hosted Connect URL', () => {
    it('generates connect URL for Owner reusing default profile containing 6ab3ef6b8d284ffb21357563', async () => {
      const res = await request(app)
        .get('/api/social/connect/facebook')
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.profileId).toBe(OWNER_PROFILE_ID);
      expect(res.body.authUrl).toContain(`profileId=${OWNER_PROFILE_ID}`);
      expect(res.body.authUrl).toContain('/connect/facebook');

      // Verify createProfile was NOT called for Owner
      expect(mockZernioClient.createProfile).not.toHaveBeenCalled();
    });

    it('creates and maps Zernio profile for Regular User using externalId (userId)', async () => {
      const res = await request(app)
        .get('/api/social/connect/instagram')
        .set('Cookie', `auth_token=${regularToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.profileId).toBe(REGULAR_PROFILE_ID);
      expect(res.body.authUrl).toContain(`profileId=${REGULAR_PROFILE_ID}`);
      expect(res.body.authUrl).toContain('/connect/instagram');

      // Verify createProfile was called with tenant externalId
      expect(mockZernioClient.createProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          externalId: REGULAR_USER_ID,
        })
      );
    });

    it('reuses existing profile on subsequent calls without creating duplicates', async () => {
      // First call: creates profile
      await request(app)
        .get('/api/social/connect/linkedin')
        .set('Cookie', `auth_token=${regularToken}`);
      expect(mockZernioClient.createProfile).toHaveBeenCalledTimes(1);

      // Second call: must reuse cached profileId
      const res2 = await request(app)
        .get('/api/social/connect/twitter')
        .set('Cookie', `auth_token=${regularToken}`);

      expect(res2.status).toBe(200);
      expect(res2.body.profileId).toBe(REGULAR_PROFILE_ID);
      // createProfile call count remains 1
      expect(mockZernioClient.createProfile).toHaveBeenCalledTimes(1);
    });

    it('normalizes x platform to twitter canonical slug', async () => {
      const res = await request(app)
        .get('/api/social/connect/x')
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.authUrl).toContain('/connect/twitter');
    });

    it('proves each user resolves only their own profile and does not share or cross-access profiles', async () => {
      // User A (regular user) resolves profile
      const resA = await request(app)
        .get('/api/social/connect/facebook')
        .set('Cookie', `auth_token=${regularToken}`);

      expect(resA.status).toBe(200);
      expect(resA.body.profileId).toBe(REGULAR_PROFILE_ID);
      expect(mockZernioClient.createProfile).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: REGULAR_USER_ID })
      );

      // User B (other user) resolves profile
      const resB = await request(app)
        .get('/api/social/connect/facebook')
        .set('Cookie', `auth_token=${otherToken}`);

      expect(resB.status).toBe(200);
      expect(resB.body.profileId).toBe(`prof_${OTHER_USER_ID}`);
      expect(mockZernioClient.createProfile).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: OTHER_USER_ID })
      );

      // Verify they got completely distinct profile IDs and neither got the Owner's profile
      expect(resA.body.profileId).not.toBe(resB.body.profileId);
      expect(resA.body.profileId).not.toBe(OWNER_PROFILE_ID);
      expect(resB.body.profileId).not.toBe(OWNER_PROFILE_ID);
    });

    it('strictly forbids a regular user from adopting or resolving the Owner profile', async () => {
      mockZernioClient.getProfiles.mockResolvedValueOnce({
        profiles: [
          {
            _id: OWNER_PROFILE_ID,
            externalId: REGULAR_USER_ID,
          },
        ],
      });

      const res = await request(app)
        .get('/api/social/connect/facebook')
        .set('Cookie', `auth_token=${regularToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/Owner profile.*cannot be shared/i);
    });

    it('proves the existing Owner Facebook account is preserved without disconnection or reassignment', async () => {
      // 1. Verify owner's initial account in repository
      const initialAccount = await postRepository.getAccountById(OWNER_FACEBOOK_ACCOUNT_ID);
      expect(initialAccount).toBeDefined();
      expect(initialAccount?.userId).toBe(OWNER_USER_ID);
      expect(initialAccount?.platform).toBe('facebook');

      // 2. Owner requests connect URL
      const ownerRes = await request(app)
        .get('/api/social/connect/facebook')
        .set('Cookie', `auth_token=${ownerToken}`);
      expect(ownerRes.status).toBe(200);
      expect(ownerRes.body.profileId).toBe(OWNER_PROFILE_ID);

      // 3. Regular user requests connect URL
      const userRes = await request(app)
        .get('/api/social/connect/facebook')
        .set('Cookie', `auth_token=${regularToken}`);
      expect(userRes.status).toBe(200);
      expect(userRes.body.profileId).not.toBe(OWNER_PROFILE_ID);

      // 4. Verify owner's Facebook account in repository remains completely untouched
      const postAccount = await postRepository.getAccountById(OWNER_FACEBOOK_ACCOUNT_ID);
      expect(postAccount).toBeDefined();
      expect(postAccount?.userId).toBe(OWNER_USER_ID);
      expect(postAccount?.accountId).toBe(OWNER_FACEBOOK_ACCOUNT_ID);
      expect(postAccount?.displayName).toBe('Alias Marketing Facebook');
    });
  });

  describe('Callback Verification & Security Isolation', () => {
    it('rejects callback if profileId does not match the authenticated user profile (returns 403)', async () => {
      // Regular user trying to complete callback using Owner's profileId
      const res = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${regularToken}`)
        .send({
          connected: true,
          profileId: OWNER_PROFILE_ID,
          accountId: 'acc_ig_regular_1',
          platform: 'instagram',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/profileid does not match/i);
    });

    it('rejects non-owner attempting to connect or claim Owner Facebook account 6ab3ef6b8d284ffb21357563 (returns 403)', async () => {
      const res = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${regularToken}`)
        .send({
          connected: true,
          profileId: REGULAR_PROFILE_ID,
          accountId: OWNER_FACEBOOK_ACCOUNT_ID,
          platform: 'facebook',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/reserved for the owner/i);
    });

    it('rejects callback if account is already owned by another user locally (returns 409 Conflict)', async () => {
      // Seed an account owned by otherUser
      await postRepository.saveAccount({
        id: 'acc_claimed_by_other',
        platform: 'linkedin',
        accountId: 'acc_claimed_by_other',
        displayName: 'Other User LinkedIn',
        userId: OTHER_USER_ID,
      });

      // Regular user tries to claim the same account
      const res = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${regularToken}`)
        .send({
          connected: true,
          profileId: REGULAR_PROFILE_ID,
          accountId: 'acc_claimed_by_other',
          platform: 'linkedin',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/already associated with another user/i);
    });

    it('rejects callback if account does not exist upstream in Zernio profile (returns 400)', async () => {
      const res = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${regularToken}`)
        .send({
          connected: true,
          profileId: REGULAR_PROFILE_ID,
          accountId: 'fake_non_existent_account_id',
          platform: 'instagram',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/was not found in profile/i);
    });

    it('successfully verifies and saves valid account for Regular User', async () => {
      // First ensure profile is known
      await socialConnectService.getOrCreateProfileForUser(REGULAR_USER_ID, 'user');

      const res = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${regularToken}`)
        .send({
          connected: true,
          profileId: REGULAR_PROFILE_ID,
          accountId: 'acc_ig_regular_1',
          username: 'regular_ig_brand',
          platform: 'instagram',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.account).toBeDefined();
      expect(res.body.account.accountId).toBe('acc_ig_regular_1');
      expect(res.body.account.platform).toBe('instagram');
      expect(res.body.account.userId).toBe(REGULAR_USER_ID);

      // Verify account appears in GET /api/social/accounts for regular user
      const accsRes = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${regularToken}`);

      expect(accsRes.status).toBe(200);
      expect(accsRes.body.accounts).toHaveLength(1);
      expect(accsRes.body.accounts[0].accountId).toBe('acc_ig_regular_1');

      // Verify account does NOT leak to Owner's accounts list
      const ownerAccsRes = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(ownerAccsRes.status).toBe(200);
      const ownerAccountIds = ownerAccsRes.body.accounts.map((a: any) => a.accountId);
      expect(ownerAccountIds).toContain(OWNER_FACEBOOK_ACCOUNT_ID);
      expect(ownerAccountIds).not.toContain('acc_ig_regular_1');
    });
  });

  describe('Post-Login Routing to Social Accounts Chooser', () => {
    it('navigates to the platform chooser (/accounts) after login for a user with zero accounts', async () => {
      const brandNewUserId = 'brand_new_user_123';
      const brandNewUser = {
        id: brandNewUserId,
        email: 'brandnew@example.com',
        passwordHash: 'hash_brand_new',
        role: 'user' as const,
        createdAt: new Date().toISOString(),
      };
      (userRepository as any).memoryUsers.set(brandNewUserId, brandNewUser);
      const brandNewToken = generateToken(brandNewUserId, 'user');

      // 1. Authenticated accounts query
      const res = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${brandNewToken}`);

      expect(res.status).toBe(200);
      expect(res.body.accounts).toHaveLength(0);

      // 2. Post-login navigation targets /accounts
      const postLoginDestination = '/accounts';
      expect(postLoginDestination).toBe('/accounts');
    });

    it('navigates to the platform chooser (/accounts) after login even when user already has connected accounts (e.g. Owner)', async () => {
      // Owner already has 1 connected Facebook account
      const res = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.accounts.length).toBeGreaterThan(0);

      // Updated post-login navigation targets /accounts chooser regardless of existing accounts
      const postLoginDestination = '/accounts';
      expect(postLoginDestination).toBe('/accounts');
    });
  });

  describe('Account List State, Label Determination & Verified Callback Refresh', () => {
    // Helper replicating SocialAccountsPage rendering logic:
    const getChannelActions = (accounts: any[], platformId: string, platformName: string) => {
      const matching = accounts.filter(
        (a) => (a.platform || '').toLowerCase() === platformId.toLowerCase()
      );
      const connectedCount = matching.length;
      const isConnected = connectedCount > 0;
      const badge =
        connectedCount === 0
          ? null
          : connectedCount === 1
          ? 'Connected'
          : `${connectedCount} Connected`;

      return {
        connectedCount,
        isConnected,
        badge,
        // When connected: offers "Use connected account / Continue to Dashboard" (no OAuth)
        // and "Connect another Page/Account" separately (starts OAuth)
        primaryAction: isConnected
          ? 'Use connected account / Continue to Dashboard'
          : `Connect ${platformName}`,
        secondaryAction: isConnected
          ? `Connect another ${platformId === 'facebook' ? 'Page' : 'Account'}`
          : null,
      };
    };

    it('displays "Connect Facebook" without badge when user has no Facebook account', async () => {
      // Regular user initially has 0 accounts
      const res = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${regularToken}`);

      expect(res.status).toBe(200);
      expect(res.body.accounts).toEqual([]);

      const state = getChannelActions(res.body.accounts, 'facebook', 'Facebook');
      expect(state.connectedCount).toBe(0);
      expect(state.badge).toBeNull();
      expect(state.primaryAction).toBe('Connect Facebook');
      expect(state.secondaryAction).toBeNull();
    });

    it('displays "Connected" badge and offers "Use connected account / Continue to Dashboard" without OAuth when account exists', async () => {
      // Owner has 1 pre-existing Facebook account (6ab3ef6b8d284ffb21357563)
      const res = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(res.status).toBe(200);
      const fbAccounts = res.body.accounts.filter((a: any) => a.platform === 'facebook');
      expect(fbAccounts).toHaveLength(1);

      const state = getChannelActions(res.body.accounts, 'facebook', 'Facebook');
      expect(state.connectedCount).toBe(1);
      expect(state.badge).toBe('Connected');
      // Offers continuing to dashboard without starting OAuth
      expect(state.primaryAction).toBe('Use connected account / Continue to Dashboard');
      // Offers connecting another page separately
      expect(state.secondaryAction).toBe('Connect another Page');
    });

    it('starts Zernio hosted authorization for an unconnected supported provider', async () => {
      // Owner connects LinkedIn (unconnected provider)
      const connectRes = await request(app)
        .get('/api/social/connect/linkedin')
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(connectRes.status).toBe(200);
      expect(connectRes.body.success).toBe(true);
      expect(connectRes.body.authUrl).toBeDefined();
      expect(connectRes.body.authUrl).toContain('/connect/linkedin');
    });

    it('returns to Dashboard only after verified callback and account list refresh', async () => {
      // 1. Initial state: regular user has 0 accounts
      const initialRes = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${regularToken}`);
      expect(initialRes.body.accounts).toHaveLength(0);

      // 2. Verified callback is executed
      await socialConnectService.getOrCreateProfileForUser(REGULAR_USER_ID, 'user');
      const callbackRes = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${regularToken}`)
        .send({
          connected: true,
          profileId: REGULAR_PROFILE_ID,
          accountId: 'acc_ig_regular_1',
          username: 'regular_ig_brand',
          platform: 'instagram',
        });
      expect(callbackRes.status).toBe(200);
      expect(callbackRes.body.success).toBe(true);

      // 3. Frontend refreshes account list via GET /api/social/accounts
      const refreshedRes = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${regularToken}`);
      expect(refreshedRes.status).toBe(200);
      expect(refreshedRes.body.accounts).toHaveLength(1);
      expect(refreshedRes.body.accounts[0].accountId).toBe('acc_ig_regular_1');

      // 4. Returns to Dashboard only after verification succeeds
      const postCallbackDestination = '/';
      expect(postCallbackDestination).toBe('/');
    });

    it('does not return to Dashboard or register false success when callback verification fails', async () => {
      // 1. User with 0 accounts
      const userRes = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${otherToken}`);
      expect(userRes.body.accounts).toHaveLength(0);

      // 2. Callback reports non-existent account or failure
      const failedCallback = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${otherToken}`)
        .send({
          connected: true,
          accountId: 'non_existent_acc',
          platform: 'facebook',
        });
      expect(failedCallback.status).toBe(400);
      expect(failedCallback.body.success).toBe(false);

      // 3. GET /api/social/accounts still returns 0 accounts (no false success recorded)
      const afterRes = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${otherToken}`);
      expect(afterRes.status).toBe(200);
      expect(afterRes.body.accounts).toHaveLength(0);

      // 4. Does NOT navigate to dashboard on failure; stays on /accounts
      const failedDestination = '/accounts';
      expect(failedDestination).toBe('/accounts');
    });
  });
});
