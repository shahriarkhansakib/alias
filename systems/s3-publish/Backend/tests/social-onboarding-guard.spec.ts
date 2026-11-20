import request from 'supertest';
import { createApp } from '../src/app';
import { PostRepositoryService } from '../src/social/services/post-repository.service';
import { UserRepository } from '../src/auth/user.repository';
import { SocialConnectService, OWNER_FACEBOOK_ACCOUNT_ID } from '../src/social/services/social-connect.service';
import { generateToken } from '../src/auth/auth.service';

// In-memory SessionStorage simulator to verify user-scoped browser session behavior
class MockBrowserSessionStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// Client-side Auth & Navigation State Machine replicating AuthContext, AccountSelectionGuard & Sidebar
class FrontendAuthClient {
  public user: { id: string; email: string; role: string } | null = null;
  public hasSelectedAccount: boolean = false;
  public sessionStorage: MockBrowserSessionStorage;

  constructor(sessionStorage?: MockBrowserSessionStorage) {
    this.sessionStorage = sessionStorage || new MockBrowserSessionStorage();
  }

  private getSessionKey(userId: string): string {
    return `social_onboarding_completed_${userId}`;
  }

  login(user: { id: string; email: string; role: string }): void {
    // Fresh account-selection step on every login: reset stored state and flag
    this.sessionStorage.removeItem(this.getSessionKey(user.id));
    this.user = user;
    this.hasSelectedAccount = false;
  }

  signup(user: { id: string; email: string; role: string }): void {
    // Fresh account-selection step on every signup
    this.sessionStorage.removeItem(this.getSessionKey(user.id));
    this.user = user;
    this.hasSelectedAccount = false;
  }

  restoreSession(user: { id: string; email: string; role: string }): void {
    this.user = user;
    // Only restore if this exact user previously completed selection in this browser session
    this.hasSelectedAccount = this.sessionStorage.getItem(this.getSessionKey(user.id)) === 'true';
  }

  completeAccountSelection(): void {
    if (this.user) {
      this.sessionStorage.setItem(this.getSessionKey(this.user.id), 'true');
    }
    this.hasSelectedAccount = true;
  }

  logout(): void {
    if (this.user) {
      this.sessionStorage.removeItem(this.getSessionKey(this.user.id));
    }
    this.user = null;
    this.hasSelectedAccount = false;
  }

  // Route Guard Simulator (replicates AccountSelectionGuard)
  navigateRoute(path: string): { allowed: boolean; redirectedTo: string } {
    if (!this.user) {
      return { allowed: false, redirectedTo: '/login' };
    }
    // Social accounts page is always accessible without selection
    if (path === '/accounts' || path === '/social-accounts') {
      return { allowed: true, redirectedTo: path };
    }
    // Protected app routes require hasSelectedAccount
    if (!this.hasSelectedAccount) {
      return { allowed: false, redirectedTo: '/accounts' };
    }
    return { allowed: true, redirectedTo: path };
  }

  // Sidebar Links Simulator (replicates Sidebar.jsx)
  getSidebarItems(): Array<{ label: string; path: string; disabled: boolean; ariaDisabled: boolean }> {
    const navItems = [
      { label: 'Dashboard', path: '/' },
      { label: 'Create Post', path: '/create' },
      { label: 'All Posts', path: '/posts' },
      { label: 'Analytics', path: '/analytics' },
      { label: 'Social Accounts', path: '/accounts' },
    ];

    return navItems.map((item) => {
      const isAccounts = item.path === '/accounts';
      const isDisabled = !this.hasSelectedAccount && !isAccounts;
      return {
        label: item.label,
        path: item.path,
        disabled: isDisabled,
        ariaDisabled: isDisabled,
      };
    });
  }
}

describe('Frontend Social Account Onboarding Guard & Navigation Suite', () => {
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

    (userRepository as any).memoryUsers.set(OWNER_USER_ID, {
      id: OWNER_USER_ID,
      email: 'owner@example.com',
      passwordHash: 'hashed_pass_owner',
      role: 'owner' as const,
      createdAt: new Date().toISOString(),
    });
    (userRepository as any).memoryUsers.set(REGULAR_USER_ID, {
      id: REGULAR_USER_ID,
      email: 'regular@example.com',
      passwordHash: 'hashed_pass_reg',
      role: 'user' as const,
      createdAt: new Date().toISOString(),
    });
    (userRepository as any).memoryUsers.set(OTHER_USER_ID, {
      id: OTHER_USER_ID,
      email: 'other@example.com',
      passwordHash: 'hashed_pass_other',
      role: 'user' as const,
      createdAt: new Date().toISOString(),
    });

    // Seed Owner's pre-existing Facebook Page
    await postRepository.saveAccount({
      id: OWNER_FACEBOOK_ACCOUNT_ID,
      platform: 'facebook',
      accountId: OWNER_FACEBOOK_ACCOUNT_ID,
      displayName: 'AliasmarketingBd',
      userId: OWNER_USER_ID,
    });

    ownerToken = generateToken(OWNER_USER_ID, 'owner');
    regularToken = generateToken(REGULAR_USER_ID, 'user');
    otherToken = generateToken(OTHER_USER_ID, 'user');

    mockZernioClient = {
      getApiKey: jest.fn().mockReturnValue('mock_api_key'),
      listAccounts: jest.fn().mockImplementation(async (params: { profileId: string }) => {
        if (params.profileId === OWNER_PROFILE_ID) {
          return {
            accounts: [
              {
                _id: OWNER_FACEBOOK_ACCOUNT_ID,
                profileId: OWNER_PROFILE_ID,
                platform: 'facebook',
                username: 'AliasmarketingBd',
                displayName: 'AliasmarketingBd',
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
          return {
            profiles: [
              {
                _id: REGULAR_PROFILE_ID,
                name: 'Regular Profile',
                externalId: REGULAR_USER_ID,
              },
            ],
          };
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

  describe('1. Owner with Existing Facebook Account Gate & Explicit Continue', () => {
    it('blocks app feature pages and keeps sidebar disabled before Owner explicitly chooses Continue', async () => {
      // 1. Owner logs in
      const frontend = new FrontendAuthClient();
      frontend.login({ id: OWNER_USER_ID, email: 'owner@example.com', role: 'owner' });

      // 2. Fresh login leaves hasSelectedAccount = false
      expect(frontend.hasSelectedAccount).toBe(false);

      // 3. Direct route attempts to app pages are blocked and redirect to /accounts
      expect(frontend.navigateRoute('/')).toEqual({ allowed: false, redirectedTo: '/accounts' });
      expect(frontend.navigateRoute('/create')).toEqual({ allowed: false, redirectedTo: '/accounts' });
      expect(frontend.navigateRoute('/posts')).toEqual({ allowed: false, redirectedTo: '/accounts' });
      expect(frontend.navigateRoute('/analytics')).toEqual({ allowed: false, redirectedTo: '/accounts' });

      // /accounts itself is directly accessible
      expect(frontend.navigateRoute('/accounts')).toEqual({ allowed: true, redirectedTo: '/accounts' });

      // 4. Sidebar links to Dashboard, Create Post, All Posts, and Analytics are disabled
      const sidebarItems = frontend.getSidebarItems();
      const dashboardItem = sidebarItems.find((i) => i.label === 'Dashboard')!;
      const createItem = sidebarItems.find((i) => i.label === 'Create Post')!;
      const postsItem = sidebarItems.find((i) => i.label === 'All Posts')!;
      const analyticsItem = sidebarItems.find((i) => i.label === 'Analytics')!;
      const accountsItem = sidebarItems.find((i) => i.label === 'Social Accounts')!;

      expect(dashboardItem.disabled).toBe(true);
      expect(dashboardItem.ariaDisabled).toBe(true);
      expect(createItem.disabled).toBe(true);
      expect(postsItem.disabled).toBe(true);
      expect(analyticsItem.disabled).toBe(true);

      // Social Accounts remains enabled
      expect(accountsItem.disabled).toBe(false);
      expect(accountsItem.ariaDisabled).toBe(false);

      // 5. Backend confirms Owner genuinely has 1 existing connected Facebook account
      const accountsRes = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${ownerToken}`);

      expect(accountsRes.status).toBe(200);
      expect(accountsRes.body.accounts).toHaveLength(1);
      expect(accountsRes.body.accounts[0].platform).toBe('facebook');
      expect(accountsRes.body.accounts[0].accountId).toBe(OWNER_FACEBOOK_ACCOUNT_ID);

      // Mere existence of the account does NOT unlock hasSelectedAccount
      expect(frontend.hasSelectedAccount).toBe(false);
    });

    it('unlocks Dashboard and restores full sidebar navigation only after explicit Continue action', () => {
      const frontend = new FrontendAuthClient();
      frontend.login({ id: OWNER_USER_ID, email: 'owner@example.com', role: 'owner' });
      expect(frontend.hasSelectedAccount).toBe(false);

      // User explicitly clicks "Use connected account / Continue to Dashboard"
      frontend.completeAccountSelection();

      // hasSelectedAccount is now true
      expect(frontend.hasSelectedAccount).toBe(true);

      // Direct routes are now allowed
      expect(frontend.navigateRoute('/')).toEqual({ allowed: true, redirectedTo: '/' });
      expect(frontend.navigateRoute('/create')).toEqual({ allowed: true, redirectedTo: '/create' });
      expect(frontend.navigateRoute('/posts')).toEqual({ allowed: true, redirectedTo: '/posts' });
      expect(frontend.navigateRoute('/analytics')).toEqual({ allowed: true, redirectedTo: '/analytics' });

      // All sidebar links are enabled
      const sidebarItems = frontend.getSidebarItems();
      sidebarItems.forEach((item) => {
        expect(item.disabled).toBe(false);
        expect(item.ariaDisabled).toBe(false);
      });
    });
  });

  describe('2. Verified Callback Unlocking Flow', () => {
    it('unlocks Dashboard only after successful callback verification AND account list refresh', async () => {
      const frontend = new FrontendAuthClient();
      frontend.login({ id: REGULAR_USER_ID, email: 'regular@example.com', role: 'user' });
      expect(frontend.hasSelectedAccount).toBe(false);

      // 1. Initial account fetch confirms 0 accounts
      const initialAccounts = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${regularToken}`);
      expect(initialAccounts.body.accounts).toHaveLength(0);

      // Pre-seed profile for regular user
      await socialConnectService.getOrCreateProfileForUser(REGULAR_USER_ID, 'user');

      // 2. Submit verified callback to backend
      const callbackRes = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${regularToken}`)
        .send({
          connected: true,
          profileId: REGULAR_PROFILE_ID,
          accountId: 'acc_ig_regular_1',
          platform: 'instagram',
          username: 'regular_ig_brand',
        });
      expect(callbackRes.status).toBe(200);
      expect(callbackRes.body.success).toBe(true);

      // 3. Frontend refreshes account list
      const refreshedAccounts = await request(app)
        .get('/api/social/accounts')
        .set('Cookie', `auth_token=${regularToken}`);
      expect(refreshedAccounts.body.accounts).toHaveLength(1);
      expect(refreshedAccounts.body.accounts[0].accountId).toBe('acc_ig_regular_1');

      // 4. Client marks onboarding completed
      frontend.completeAccountSelection();
      expect(frontend.hasSelectedAccount).toBe(true);

      // App routes are unlocked
      expect(frontend.navigateRoute('/')).toEqual({ allowed: true, redirectedTo: '/' });
    });

    it('does NOT unlock Dashboard or app navigation when callback verification fails', async () => {
      const frontend = new FrontendAuthClient();
      frontend.login({ id: OTHER_USER_ID, email: 'other@example.com', role: 'user' });
      expect(frontend.hasSelectedAccount).toBe(false);

      // Submit invalid/unverified callback (e.g. non-existent account)
      const callbackRes = await request(app)
        .post('/api/social/connect/callback')
        .set('Cookie', `auth_token=${otherToken}`)
        .send({
          connected: true,
          accountId: 'non_existent_account',
          platform: 'facebook',
        });

      expect(callbackRes.status).toBe(400);
      expect(callbackRes.body.success).toBe(false);

      // Client does NOT call completeAccountSelection on error
      expect(frontend.hasSelectedAccount).toBe(false);

      // App remains locked to /accounts
      expect(frontend.navigateRoute('/')).toEqual({ allowed: false, redirectedTo: '/accounts' });
      expect(frontend.navigateRoute('/analytics')).toEqual({ allowed: false, redirectedTo: '/accounts' });

      const sidebarItems = frontend.getSidebarItems();
      expect(sidebarItems.find((i) => i.label === 'Dashboard')!.disabled).toBe(true);
    });
  });

  describe('3. Session Storage Isolation, User Switching & Logout Reset', () => {
    it('resets onboarding state upon logout and clears stored session key', () => {
      const sessionStorage = new MockBrowserSessionStorage();
      const frontend = new FrontendAuthClient(sessionStorage);

      frontend.login({ id: OWNER_USER_ID, email: 'owner@example.com', role: 'owner' });
      frontend.completeAccountSelection();
      expect(frontend.hasSelectedAccount).toBe(true);
      expect(sessionStorage.getItem(`social_onboarding_completed_${OWNER_USER_ID}`)).toBe('true');

      // Logout
      frontend.logout();
      expect(frontend.user).toBeNull();
      expect(frontend.hasSelectedAccount).toBe(false);
      expect(sessionStorage.getItem(`social_onboarding_completed_${OWNER_USER_ID}`)).toBeNull();

      // Navigation redirects to /login when logged out
      expect(frontend.navigateRoute('/')).toEqual({ allowed: false, redirectedTo: '/login' });
    });

    it('prevents user B from inheriting user A completion status when switching users in the same browser', () => {
      const sessionStorage = new MockBrowserSessionStorage();

      // User A (Owner) completes selection
      const frontendA = new FrontendAuthClient(sessionStorage);
      frontendA.login({ id: OWNER_USER_ID, email: 'owner@example.com', role: 'owner' });
      frontendA.completeAccountSelection();
      expect(frontendA.hasSelectedAccount).toBe(true);

      // User B logs in
      const frontendB = new FrontendAuthClient(sessionStorage);
      frontendB.login({ id: REGULAR_USER_ID, email: 'regular@example.com', role: 'user' });

      // User B MUST NOT inherit User A's completed state
      expect(frontendB.hasSelectedAccount).toBe(false);
      expect(sessionStorage.getItem(`social_onboarding_completed_${REGULAR_USER_ID}`)).toBeNull();

      // User B is locked to /accounts
      expect(frontendB.navigateRoute('/')).toEqual({ allowed: false, redirectedTo: '/accounts' });
      expect(frontendB.navigateRoute('/create')).toEqual({ allowed: false, redirectedTo: '/accounts' });
    });

    it('requires a fresh account selection step when the same user logs in again', () => {
      const sessionStorage = new MockBrowserSessionStorage();
      const frontend = new FrontendAuthClient(sessionStorage);

      // Session 1: Owner logs in and completes selection
      frontend.login({ id: OWNER_USER_ID, email: 'owner@example.com', role: 'owner' });
      frontend.completeAccountSelection();
      expect(frontend.hasSelectedAccount).toBe(true);

      // User logs in again (new login)
      frontend.login({ id: OWNER_USER_ID, email: 'owner@example.com', role: 'owner' });

      // MUST start fresh account selection step
      expect(frontend.hasSelectedAccount).toBe(false);
      expect(frontend.navigateRoute('/')).toEqual({ allowed: false, redirectedTo: '/accounts' });
    });
  });
});
