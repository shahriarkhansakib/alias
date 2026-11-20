import { ZernioClient } from '../providers/zernio/zernio.client';
import { PostRepositoryService, SocialAccountRecord } from './post-repository.service';
import { UserRepository } from '../../auth/user.repository';
import { SocialPublishingError } from '../types/publisher.types';

export const SUPPORTED_CONNECT_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'twitter', 'x'];
export const OWNER_FACEBOOK_ACCOUNT_ID = '6ab3ef6b8d284ffb21357563';
export const OWNER_DEFAULT_PROFILE_ID = '6ab3ed260b5ca69486b5eedb';

export class SocialConnectService {
  private zernioClient: ZernioClient;
  private postRepository: PostRepositoryService;
  private userRepository: UserRepository;

  constructor(
    zernioClient: ZernioClient,
    postRepository: PostRepositoryService,
    userRepository: UserRepository
  ) {
    this.zernioClient = zernioClient;
    this.postRepository = postRepository;
    this.userRepository = userRepository;
  }

  public normalizePlatform(platform: string): string {
    const norm = (platform || '').toLowerCase().trim();
    if (norm === 'x') return 'twitter';
    return norm;
  }

  public isPlatformSupported(platform: string): boolean {
    const norm = (platform || '').toLowerCase().trim();
    return SUPPORTED_CONNECT_PLATFORMS.includes(norm);
  }

  /**
   * Resolves or creates a Zernio profile for the given user in a concurrency-safe manner.
   * - Owner: Reuses the existing profile containing Facebook account 6ab3ef6b8d284ffb21357563 (or default profile).
   * - Regular user: Resolves by externalId (userId) or creates one, handling conflicts gracefully.
   */
  public async getOrCreateProfileForUser(
    userId: string,
    role: string,
    userEmail?: string
  ): Promise<string> {
    // 1. Check if user already has a saved zernioProfileId in repository or cache
    const user = await this.userRepository.findById(userId);
    if (user?.zernioProfileId && typeof user.zernioProfileId === 'string' && user.zernioProfileId.trim()) {
      return user.zernioProfileId.trim();
    }

    const effectiveRole = user?.role === 'owner' || role === 'owner' ? 'owner' : 'user';

    // 2. Owner profile resolution: reuse existing Owner profile containing 6ab3ef6b8d284ffb21357563
    if (effectiveRole === 'owner') {
      let profileId: string | undefined;

      try {
        const profsRes = await this.zernioClient.getProfiles();
        const profList = Array.isArray(profsRes)
          ? profsRes
          : profsRes?.profiles || profsRes?.data || (profsRes?.profile ? [profsRes.profile] : []);
        const defaultProf = profList.find(
          (p: any) =>
            p.isDefault ||
            p._id === OWNER_DEFAULT_PROFILE_ID ||
            p.id === OWNER_DEFAULT_PROFILE_ID ||
            p.name === 'Default Profile' ||
            p.name === 'Default'
        );
        if (defaultProf) {
          const id = defaultProf._id || defaultProf.id;
          if (typeof id === 'string' && id.trim()) {
            profileId = id.trim();
          }
        }
      } catch (err) {
        console.warn(
          '[SocialConnectService] Could not inspect Zernio profiles for Owner default:',
          err
        );
      }

      if (!profileId) {
        profileId = OWNER_DEFAULT_PROFILE_ID;
      }

      // Safe verification with explicit profileId so Zernio listAccounts never fails with "profileId is required"
      try {
        const accsRes = await this.zernioClient.listAccounts({ profileId });
        const accList = Array.isArray(accsRes)
          ? accsRes
          : accsRes?.accounts || accsRes?.data || [];
        const ownerAcc = accList.find(
          (a: any) =>
            a._id === OWNER_FACEBOOK_ACCOUNT_ID ||
            a.id === OWNER_FACEBOOK_ACCOUNT_ID ||
            a.accountId === OWNER_FACEBOOK_ACCOUNT_ID
        );
        if (ownerAcc) {
          const rawId =
            ownerAcc.profileId ||
            ownerAcc.profile?._id ||
            ownerAcc.profile?.id ||
            (typeof ownerAcc.profile === 'string' ? ownerAcc.profile : undefined);
          if (rawId && typeof rawId === 'string' && rawId.trim()) {
            profileId = rawId.trim();
          }
        }
      } catch (err) {
        console.warn(
          '[SocialConnectService] Note: accounts verification for Owner profile skipped:',
          err
        );
      }

      if (!profileId || typeof profileId !== 'string') {
        profileId = OWNER_DEFAULT_PROFILE_ID;
      }

      await this.userRepository.updateZernioProfileId(userId, profileId);
      return profileId;
    }

    // 3. Regular user profile resolution: query by externalId (tenant mapping)
    // Never allow regular users to share or adopt the Owner profile
    try {
      const existingProfs = await this.zernioClient.getProfiles({
        externalId: userId,
      });
      const list = Array.isArray(existingProfs)
        ? existingProfs
        : existingProfs?.profiles || existingProfs?.data || (existingProfs?.profile ? [existingProfs.profile] : []);
      const matched = list.find(
        (p: any) =>
          p.externalId === userId ||
          p.external_id === userId ||
          p.profile?.externalId === userId ||
          p.profile?.external_id === userId
      );
      if (matched) {
        const profId =
          matched._id ||
          matched.id ||
          matched.profile?._id ||
          matched.profile?.id;
        if (profId && typeof profId === 'string' && profId.trim()) {
          const cleanId = profId.trim();
          if (cleanId === OWNER_DEFAULT_PROFILE_ID) {
            throw new SocialPublishingError(
              'Forbidden: regular user profile resolution matched Owner profile. Profiles cannot be shared.',
              403
            );
          }
          await this.userRepository.updateZernioProfileId(userId, cleanId);
          return cleanId;
        }
      }
    } catch (err) {
      if (err instanceof SocialPublishingError && err.statusCode === 403) {
        throw err;
      }
      console.warn(
        '[SocialConnectService] Error checking existing profiles by externalId:',
        err
      );
    }

    // 4. Create new profile for tenant
    try {
      const createRes = await this.zernioClient.createProfile({
        name: userEmail ? `Tenant (${userEmail})` : `Tenant (${userId})`,
        externalId: userId,
      });

      const newProfileId =
        createRes?.profile?._id ||
        createRes?.profile?.id ||
        createRes?._id ||
        createRes?.id ||
        createRes?.data?.profile?._id ||
        createRes?.data?.profile?.id ||
        createRes?.data?._id ||
        createRes?.data?.id;

      if (newProfileId && typeof newProfileId === 'string' && newProfileId.trim()) {
        const cleanId = newProfileId.trim();
        if (cleanId === OWNER_DEFAULT_PROFILE_ID) {
          throw new SocialPublishingError(
            'Forbidden: created profile returned Owner profile ID. Profiles cannot be shared.',
            403
          );
        }
        await this.userRepository.updateZernioProfileId(userId, cleanId);
        return cleanId;
      }
    } catch (err: any) {
      // Handle 409 Conflict if profile with externalId already exists
      const statusCode = err.statusCode || err.status || err.response?.status;
      if (statusCode === 409) {
        const existingId =
          err.details?.existingProfileId ||
          err.details?.details?.existingProfileId ||
          err.details?.providerError?.details?.existingProfileId ||
          err.providerError?.details?.existingProfileId ||
          err.details?.profileId ||
          err.details?.profile?._id ||
          err.details?.profile?.id;

        if (existingId && typeof existingId === 'string' && existingId.trim()) {
          const cleanId = existingId.trim();
          if (cleanId === OWNER_DEFAULT_PROFILE_ID) {
            throw new SocialPublishingError(
              'Forbidden: conflict profile returned Owner profile ID. Profiles cannot be shared.',
              403
            );
          }
          await this.userRepository.updateZernioProfileId(userId, cleanId);
          return cleanId;
        }

        // Retry lookup
        const refetched = await this.zernioClient.getProfiles({
          externalId: userId,
        });
        const refList = Array.isArray(refetched)
          ? refetched
          : refetched?.profiles || refetched?.data || (refetched?.profile ? [refetched.profile] : []);
        const matched = refList.find(
          (p: any) =>
            p.externalId === userId ||
            p.external_id === userId ||
            p.profile?.externalId === userId ||
            p.profile?.external_id === userId
        );
        if (matched) {
          const profId =
            matched._id ||
            matched.id ||
            matched.profile?._id ||
            matched.profile?.id;
          if (profId && typeof profId === 'string' && profId.trim()) {
            const cleanId = profId.trim();
            if (cleanId === OWNER_DEFAULT_PROFILE_ID) {
              throw new SocialPublishingError(
                'Forbidden: conflict retry profile returned Owner profile ID. Profiles cannot be shared.',
                403
              );
            }
            await this.userRepository.updateZernioProfileId(userId, cleanId);
            return cleanId;
          }
        }
      }

      throw err;
    }

    throw new SocialPublishingError(
      `Failed to resolve profileId for user '${userId}': profileId is required before redirect.`,
      400
    );
  }

  /**
   * Generates a hosted connect URL for the user and platform.
   */
  public async getConnectUrl(
    userId: string,
    role: string,
    platform: string,
    redirectUrl: string,
    userEmail?: string
  ): Promise<{ authUrl: string; profileId: string }> {
    if (!this.isPlatformSupported(platform)) {
      throw new SocialPublishingError(
        `Unsupported social platform: '${platform}'. Supported platforms are facebook, instagram, linkedin, twitter.`,
        400
      );
    }

    const normPlatform = this.normalizePlatform(platform);
    const profileId = await this.getOrCreateProfileForUser(
      userId,
      role,
      userEmail
    );

    if (!profileId || typeof profileId !== 'string' || !profileId.trim()) {
      throw new SocialPublishingError(
        `Failed to resolve profileId for user '${userId}': profileId is required before redirect.`,
        400
      );
    }

    const connectRes = await this.zernioClient.getConnectUrl(normPlatform, {
      profileId,
      redirect_url: redirectUrl,
    });

    return {
      authUrl: connectRes.authUrl,
      profileId,
    };
  }

  /**
   * Verifies account connection callback data against Zernio upstream and saves to repository.
   */
  public async verifyAndSaveConnectedAccount(
    userId: string,
    role: string,
    data: {
      connected?: boolean | string;
      profileId: string;
      accountId: string;
      username?: string;
      platform?: string;
    }
  ): Promise<SocialAccountRecord> {
    if (data.connected === false || data.connected === 'false') {
      throw new SocialPublishingError(
        'Social account connection was canceled or failed.',
        400
      );
    }

    if (!data.accountId) {
      throw new SocialPublishingError(
        'Missing required parameter: accountId',
        400
      );
    }

    // 1. Verify profile ownership: profileId in callback MUST belong to the authenticated user
    const expectedProfileId = await this.getOrCreateProfileForUser(
      userId,
      role
    );
    if (data.profileId && data.profileId !== expectedProfileId) {
      throw new SocialPublishingError(
        "Forbidden: The provided profileId does not match the authenticated user's profile.",
        403
      );
    }

    const verifiedProfileId = data.profileId || expectedProfileId;

    // 2. Reject non-owner attempting to claim Owner's Facebook account
    if (data.accountId === OWNER_FACEBOOK_ACCOUNT_ID && role !== 'owner') {
      throw new SocialPublishingError(
        "Forbidden: Account '6ab3ef6b8d284ffb21357563' is reserved for the Owner and cannot be claimed by another user.",
        403
      );
    }

    // 3. Reject if account is already owned by another user locally
    const existingLocal = await this.postRepository.getAccountById(
      data.accountId
    );
    if (
      existingLocal &&
      existingLocal.userId &&
      existingLocal.userId !== userId
    ) {
      throw new SocialPublishingError(
        'Conflict: this social account is already associated with another user.',
        409
      );
    }

    // 4. Upstream verification: verify account exists under this profile in Zernio
    const accountsRes = await this.zernioClient.listAccounts({
      profileId: verifiedProfileId,
    });
    const accountsList = Array.isArray(accountsRes)
      ? accountsRes
      : accountsRes?.accounts || [];

    const upstreamAcc = accountsList.find(
      (a: any) =>
        a._id === data.accountId ||
        a.id === data.accountId ||
        a.accountId === data.accountId
    );

    if (!upstreamAcc) {
      throw new SocialPublishingError(
        `Verification failed: Account '${data.accountId}' was not found in profile '${verifiedProfileId}' on Zernio.`,
        400
      );
    }

    // 5. Construct and persist SocialAccountRecord
    const platform = (
      upstreamAcc.platform ||
      data.platform ||
      'facebook'
    ).toLowerCase();
    const displayName =
      upstreamAcc.displayName ||
      upstreamAcc.name ||
      upstreamAcc.username ||
      data.username ||
      `${platform.charAt(0).toUpperCase() + platform.slice(1)} Account`;

    const record: SocialAccountRecord = {
      id: data.accountId,
      platform,
      accountId: data.accountId,
      displayName,
      userId,
    };

    await this.postRepository.saveAccount(record);
    return record;
  }

  /**
   * Safely disconnects a connected social account.
   * - Verifies local existence and ownership by authenticated user.
   * - Strictly forbids non-owners from disconnecting the Owner's legacy Facebook account.
   * - Verifies profile ownership and executes provider-side deleteAccount on Zernio FIRST.
   * - Only after provider-side success, removes the local social account record.
   * - Preserves all posts, history, and analytics records.
   */
  public async disconnectAccount(
    userId: string,
    role: string,
    accountId: string
  ): Promise<{ success: boolean; accountId: string; message: string }> {
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new SocialPublishingError('accountId is required to disconnect.', 400);
    }

    const cleanAccountId = accountId.trim();

    // 1. Verify the account exists locally
    const localAccount = await this.postRepository.getAccountById(cleanAccountId);
    if (!localAccount) {
      throw new SocialPublishingError(
        `Account '${cleanAccountId}' not found.`,
        404
      );
    }

    // 2. Ownership verification: account must belong to the authenticated user
    if (localAccount.userId !== userId) {
      throw new SocialPublishingError(
        'Forbidden: You do not own this connected social account.',
        403
      );
    }

    // 3. Strict guard: Non-owners must NEVER disconnect the Owner's legacy Facebook account
    if (cleanAccountId === OWNER_FACEBOOK_ACCOUNT_ID && role !== 'owner') {
      throw new SocialPublishingError(
        "Forbidden: Non-owners cannot disconnect the Owner's legacy Facebook account.",
        403
      );
    }

    // 4. Verify upstream profile ownership
    const expectedProfileId = await this.getOrCreateProfileForUser(userId, role);
    try {
      const accountsRes = await this.zernioClient.listAccounts({
        profileId: expectedProfileId,
      });
      const accountsList = Array.isArray(accountsRes)
        ? accountsRes
        : accountsRes?.accounts || [];
      const upstreamAccountFound = accountsList.some(
        (a: any) =>
          a._id === cleanAccountId ||
          a.id === cleanAccountId ||
          a.accountId === cleanAccountId
      );
      if (!upstreamAccountFound) {
        console.warn(
          `[SocialConnectService] Upstream account '${cleanAccountId}' was not listed under profile '${expectedProfileId}'. Proceeding with delete request to provider.`
        );
      }
    } catch (err) {
      console.warn('[SocialConnectService] Could not list accounts to verify upstream ownership:', err);
    }

    // 5. Call provider-side disconnect FIRST
    // If provider call throws, local association is NOT removed (no false local disconnect)
    await this.zernioClient.deleteAccount(cleanAccountId);

    // 6. Only after provider-side success, remove local connection association
    // Posts, history, and records are preserved
    await this.postRepository.deleteAccount(userId, cleanAccountId);

    return {
      success: true,
      accountId: cleanAccountId,
      message: `Account '${cleanAccountId}' disconnected successfully.`,
    };
  }
}
