import request from 'supertest';
import { createApp } from '../src/app';
import { PostRepositoryService } from '../src/social/services/post-repository.service';
import { UserRepository } from '../src/auth/user.repository';
import { SocialConnectService, OWNER_FACEBOOK_ACCOUNT_ID, OWNER_DEFAULT_PROFILE_ID } from '../src/social/services/social-connect.service';
import { generateToken } from '../src/auth/auth.service';

// Simulator for Client-side Disconnect Confirmation Dialog, UI State & Reconnect Chooser
class FrontendDisconnectStateMachine {
  public accounts: any[] = [];
  public hasSelectedAccount: boolean = true;
  public accountToDisconnect: any | null = null;
  public error: string | null = null;
  public feedback: string | null = null;

  constructor(initialAccounts: any[], hasSelectedAccount: boolean = true) {
    this.accounts = [...initialAccounts];
    this.hasSelectedAccount = hasSelectedAccount;
  }

  // User clicks Disconnect button on account card
  promptDisconnect(acc: any): void {
    this.accountToDisconnect = acc;
  }

  // User clicks Cancel on confirmation modal
  cancelDisconnect(): void {
    this.accountToDisconnect = null;
  }

  // User clicks "Disconnect Account" on confirmation modal
  async confirmDisconnect(
    disconnectApiFn: (accountId: string) => Promise<{ success: boolean; error?: string }>,
    refreshAccountsFn: () => Promise<any[]>
  ): Promise<boolean> {
    if (!this.accountToDisconnect) return false;
    const target = this.accountToDisconnect;
    const accountId = target.accountId || target.id;

    try {
      const result = await disconnectApiFn(accountId);
      if (!result.success) {
        this.error = result.error || 'Failed to disconnect';
        this.accountToDisconnect = null;
        return false;
      }

      // Reload accounts from server
      this.accounts = await refreshAccountsFn();

      // If user now has 0 connected accounts, lock feature pages and return to chooser
      if (this.accounts.length === 0) {
        this.hasSelectedAccount = false;
      }

      this.feedback = `Successfully disconnected ${target.displayName || target.accountId}. You can reconnect anytime.`;
      this.accountToDisconnect = null;
      return true;
    } catch (err: any) {
      this.error = err.message || 'Disconnect failed';
      this.accountToDisconnect = null;
      return false;
    }
  }

  // Evaluates channel card button state for a platform
  getPlatformActionState(platform: string): {
    connectedCount: number;
    primaryAction: string;
    canReconnect: boolean;
  } {
    const matching = this.accounts.filter(
      (a) => (a.platform || '').toLowerCase() === platform.toLowerCase()
    );
    const connectedCount = matching.length;
    return {
      connectedCount,
      primaryAction:
        connectedCount > 0
          ? 'Use connected account / Continue to Dashboard'
          : `Connect ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
      canReconnect: true,
    };
  }
}

describe('Social Account Disconnect & Reconnect Flow Suite', () => {
  let app: any;
  let postRepository: PostRepositoryService;
  let userRepository: UserRepository;
  let mockZernioClient: any;
  let socialConnectService: SocialConnectService;

  const OWNER_USER_ID = 'user_owner_disconnect_test';
  const REGULAR_USER_ID = 'user_regular_disconnect_test';
  const OTHER_USER_ID = 'user_other_disconnect_test';

  const REGULAR_PROFILE_ID = 'prof_reg_disconnect_123';
  const REGULAR_ACCOUNT_ID = 'acc_reg_linkedin_99';

  let ownerToken: string;
  let regularToken: string;
  let otherToken: string;

  beforeEach(async () => {
    postRepository = new PostRepositoryService();
    userRepository = new UserRepository();

    // 1. Seed users
    (userRepository as any).memoryUsers.set(OWNER_USER_ID, {
      id: OWNER_USER_ID,
      email: 'owner@example.com',
      passwordHash: 'hashed_owner',
      role: 'owner' as const,
      createdAt: new Date().toISOString(),
    });
    (userRepository as any).memoryUsers.set(REGULAR_USER_ID, {
      id: REGULAR_USER_ID,
      email: 'regular@example.com',
      passwordHash: 'hashed_reg',
      role: 'user' as const,
      createdAt: new Date().toISOString(),
    });
    (userRepository as any).memoryUsers.set(OTHER_USER_ID, {
      id: OTHER_USER_ID,
      email: 'other@example.com',
      passwordHash: 'hashed_other',
      role: 'user' as const,
      createdAt: new Date().toISOString(),
    });

    // 2. Seed Owner's legacy Facebook Page
    await postRepository.saveAccount({
      id: OWNER_FACEBOOK_ACCOUNT_ID,
      platform: 'facebook',
      accountId: OWNER_FACEBOOK_ACCOUNT_ID,
      displayName: 'Alias Marketing Facebook',
      userId: OWNER_USER_ID,
    });

    // 3. Seed Regular user's LinkedIn account
    await postRepository.saveAccount({
      id: REGULAR_ACCOUNT_ID,
      platform: 'linkedin',
      accountId: REGULAR_ACCOUNT_ID,
      displayName: 'Regular LinkedIn Profile',
      userId: REGULAR_USER_ID,
    });

    // 4. Seed sample historical posts for Owner to verify preservation
    await postRepository.save({
      internalPostId: 'post_historical_owner_1',
      idempotencyKey: 'idemp_hist_owner_1',
      caption: 'Owner Historical Facebook Post',
      status: 'published',
      userId: OWNER_USER_ID,
      publishNow: true,
      createdAt: new Date('2026-01-01').toISOString(),
      updatedAt: new Date('2026-01-01').toISOString(),
      platforms: [
        {
          platform: 'facebook',
          status: 'published',
          accountId: OWNER_FACEBOOK_ACCOUNT_ID,
          platformPostId: 'fb_post_hist_1',
        },
      ],
    });

    ownerToken = generateToken(OWNER_USER_ID, 'owner');
    regularToken = generateToken(REGULAR_USER_ID, 'user');
    otherToken = generateToken(OTHER_USER_ID, 'user');

    mockZernioClient = {
      getApiKey: jest.fn().mockReturnValue('mock_api_key'),
      listAccounts: jest.fn().mockImplementation(async (params: { profileId: string }) => {
        if (params.profileId === OWNER_DEFAULT_PROFILE_ID) {
          return {
            accounts: [
              {
                _id: OWNER_FACEBOOK_ACCOUNT_ID,
                profileId: OWNER_DEFAULT_PROFILE_ID,
                platform: 'facebook',
                username: 'AliasmarketingBd',
              },
            ],
          };
        }
        if (params.profileId === REGULAR_PROFILE_ID) {
          return {
            accounts: [
              {
                _id: REGULAR_ACCOUNT_ID,
                profileId: REGULAR_PROFILE_ID,
                platform: 'linkedin',
                username: 'regular_user',
              },
            ],
          };
        }
        return { accounts: [] };
      }),
      getProfiles: jest.fn().mockImplementation(async (params?: { externalId?: string }) => {
        if (params?.externalId === REGULAR_USER_ID) {
          return {
            profiles: [
              {
                _id: REGULAR_PROFILE_ID,
                name: 'Regular User Profile',
                externalId: REGULAR_USER_ID,
              },
            ],
          };
        }
        return {
          profiles: [
            {
              _id: OWNER_DEFAULT_PROFILE_ID,
              name: 'Default Profile',
              isDefault: true,
            },
          ],
        };
      }),
      createProfile: jest.fn().mockImplementation(async (data: { name: string; externalId?: string }) => {
        return { _id: `prof_${data.externalId || 'new'}`, name: data.name };
      }),
      getProfile: jest.fn().mockImplementation(async (profileId: string) => {
        return { _id: profileId, name: 'Profile' };
      }),
      deleteAccount: jest.fn().mockResolvedValue({ success: true, disconnected: true }),
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

  describe('1. Disconnect Ownership Checks & Security Isolation', () => {
    it('strictly forbids a non-owner from disconnecting the Owner legacy Facebook account (returns 403)', async () => {
      const res = await request(app)
        .delete(`/api/social/accounts/${OWNER_FACEBOOK_ACCOUNT_ID}`)
        .set('Cookie', `auth_token=${regularToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Forbidden');

      // Verify provider-side delete was NEVER called
      expect(mockZernioClient.deleteAccount).not.toHaveBeenCalled();

      // Verify Owner account is still in local repository
      const ownerAccounts = await postRepository.getAccounts(OWNER_USER_ID);
      expect(ownerAccounts.some((a) => a.accountId === OWNER_FACEBOOK_ACCOUNT_ID)).toBe(true);
    });

    it('forbids a user from disconnecting an account owned by another user (returns 403)', async () => {
      // Other user tries to disconnect Regular user's LinkedIn account
      const res = await request(app)
        .delete(`/api/social/accounts/${REGULAR_ACCOUNT_ID}`)
        .set('Cookie', `auth_token=${otherToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(mockZernioClient.deleteAccount).not.toHaveBeenCalled();

      // Regular user's account remains active locally
      const regAccounts = await postRepository.getAccounts(REGULAR_USER_ID);
      expect(regAccounts.some((a) => a.accountId === REGULAR_ACCOUNT_ID)).toBe(true);
    });

    it('returns 404 Not Found when disconnecting a non-existent account', async () => {
      const res = await request(app)
        .delete('/api/social/accounts/non_existent_account_123')
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(mockZernioClient.deleteAccount).not.toHaveBeenCalled();
    });
  });

  describe('2. Provider Failure Handling (No False Local Disconnect)', () => {
    it('does NOT delete the account locally when upstream provider call fails', async () => {
      // Mock Zernio upstream failure (e.g. 500 error or network outage)
      mockZernioClient.deleteAccount.mockRejectedValueOnce(
        new Error('Upstream Zernio service unavailable')
      );

      const res = await request(app)
        .delete(`/api/social/accounts/${OWNER_FACEBOOK_ACCOUNT_ID}`)
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);

      // Verify account STILL exists locally (no false local disconnect)
      const ownerAccounts = await postRepository.getAccounts(OWNER_USER_ID);
      expect(ownerAccounts.some((a) => a.accountId === OWNER_FACEBOOK_ACCOUNT_ID)).toBe(true);

      // Verify historical posts are untouched
      const histPost = await postRepository.findById('post_historical_owner_1');
      expect(histPost).not.toBeNull();
      expect(histPost?.caption).toBe('Owner Historical Facebook Post');
    });
  });

  describe('3. Successful Disconnect Preserving Post History', () => {
    it('successfully disconnects Owner account provider-side and removes local association while preserving post history', async () => {
      // 1. Initial check: Owner has 1 account and 1 historical post
      const preAccounts = await postRepository.getAccounts(OWNER_USER_ID);
      expect(preAccounts).toHaveLength(1);
      const prePost = await postRepository.findById('post_historical_owner_1');
      expect(prePost).not.toBeNull();

      // 2. Owner explicitly disconnects their own Facebook Page
      const res = await request(app)
        .delete(`/api/social/accounts/${OWNER_FACEBOOK_ACCOUNT_ID}`)
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.accountId).toBe(OWNER_FACEBOOK_ACCOUNT_ID);

      // 3. Verify Zernio DELETE was executed with exact accountId
      expect(mockZernioClient.deleteAccount).toHaveBeenCalledWith(OWNER_FACEBOOK_ACCOUNT_ID);

      // 4. Verify local social_accounts row was removed
      const postAccounts = await postRepository.getAccounts(OWNER_USER_ID);
      expect(postAccounts).toHaveLength(0);

      // 5. CRITICAL: Verify post record, platform history, and caption are completely preserved
      const postStillExists = await postRepository.findById('post_historical_owner_1');
      expect(postStillExists).not.toBeNull();
      expect(postStillExists?.internalPostId).toBe('post_historical_owner_1');
      expect(postStillExists?.caption).toBe('Owner Historical Facebook Post');
      expect(postStillExists?.platforms[0].platform).toBe('facebook');
      expect(postStillExists?.platforms[0].platformPostId).toBe('fb_post_hist_1');
    });
  });

  describe('4. Frontend State Machine: Confirmation Dialog, Cancellation & Refreshed Chooser State', () => {
    it('cancels disconnect confirmation without making API calls or modifying state', async () => {
      const initialAccounts = [
        { id: OWNER_FACEBOOK_ACCOUNT_ID, platform: 'facebook', displayName: 'Alias Marketing Facebook' },
      ];
      const ui = new FrontendDisconnectStateMachine(initialAccounts, true);

      // User clicks Disconnect -> modal opens
      ui.promptDisconnect(initialAccounts[0]);
      expect(ui.accountToDisconnect).toEqual(initialAccounts[0]);

      // User clicks Cancel
      ui.cancelDisconnect();
      expect(ui.accountToDisconnect).toBeNull();

      // State is completely intact
      expect(ui.accounts).toHaveLength(1);
      expect(ui.hasSelectedAccount).toBe(true);
      expect(mockZernioClient.deleteAccount).not.toHaveBeenCalled();
    });

    it('refreshes UI state and locks feature pages when the only connected account is disconnected', async () => {
      const initialAccounts = [
        { id: OWNER_FACEBOOK_ACCOUNT_ID, accountId: OWNER_FACEBOOK_ACCOUNT_ID, platform: 'facebook', displayName: 'Alias Marketing Facebook' },
      ];
      const ui = new FrontendDisconnectStateMachine(initialAccounts, true);

      // 1. Account is initially connected
      expect(ui.hasSelectedAccount).toBe(true);
      let actionState = ui.getPlatformActionState('facebook');
      expect(actionState.connectedCount).toBe(1);
      expect(actionState.primaryAction).toBe('Use connected account / Continue to Dashboard');

      // 2. User confirms disconnect
      ui.promptDisconnect(initialAccounts[0]);
      const disconnectCall = async (accId: string) => {
        const res = await request(app)
          .delete(`/api/social/accounts/${accId}`)
          .set('Cookie', `auth_token=${ownerToken}`);
        return { success: res.status === 200, error: res.body.error };
      };

      const refreshCall = async () => {
        const res = await request(app)
          .get('/api/social/accounts')
          .set('Cookie', `auth_token=${ownerToken}`);
        return res.body.accounts || [];
      };

      const success = await ui.confirmDisconnect(disconnectCall, refreshCall);
      expect(success).toBe(true);

      // 3. UI accounts list is refreshed from backend (0 accounts)
      expect(ui.accounts).toHaveLength(0);

      // 4. Feature pages are locked again because user now has 0 connected accounts
      expect(ui.hasSelectedAccount).toBe(false);

      // 5. Channel chooser now shows "Connect Facebook" enabling clean reconnection
      actionState = ui.getPlatformActionState('facebook');
      expect(actionState.connectedCount).toBe(0);
      expect(actionState.primaryAction).toBe('Connect Facebook');
      expect(actionState.canReconnect).toBe(true);
    });

    it('enables seamless reconnect entry for the same user profile after disconnect', async () => {
      // After disconnecting, Owner initiates reconnect for Facebook
      const connectRes = await request(app)
        .get('/api/social/connect/facebook')
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(connectRes.status).toBe(200);
      expect(connectRes.body.success).toBe(true);
      expect(connectRes.body.authUrl).toBeDefined();
      expect(connectRes.body.authUrl).toContain('/connect/facebook');
      // Reconnect uses Owner's profile
      expect(connectRes.body.authUrl).toContain(`profileId=${OWNER_DEFAULT_PROFILE_ID}`);
    });
  });
});
