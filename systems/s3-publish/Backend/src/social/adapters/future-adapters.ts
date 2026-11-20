import { IPlatformAdapter, PlatformValidationResult } from './platform-adapter.interface';
import { TargetPlatform, PublishPostInput } from '../types/publisher.types';
import { ZernioPlatformPayload } from '../providers/zernio/zernio.types';

abstract class BaseStubAdapter implements IPlatformAdapter {
  abstract readonly platformName: string;
  
  // Currently set to true so if valid accountId is provided, router handles them or reports platform status
  public isSupported(): boolean {
    return true;
  }

  public validateTarget(target: TargetPlatform, input: PublishPostInput): PlatformValidationResult {
    const errors: string[] = [];
    if (!target.accountId || typeof target.accountId !== 'string' || target.accountId.trim() === '') {
      errors.push(`${this.platformName} accountId is required and cannot be empty.`);
    }
    if (!input.imageUrl && (!input.caption || input.caption.trim() === '')) {
      errors.push(`Caption is required for ${this.platformName} text posts.`);
    }
    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public formatPayload(target: TargetPlatform, _input: PublishPostInput): ZernioPlatformPayload {
    return {
      platform: this.platformName,
      accountId: target.accountId.trim(),
    };
  }
}

export class InstagramAdapter extends BaseStubAdapter {
  public readonly platformName = 'instagram';
}

export class LinkedInAdapter extends BaseStubAdapter {
  public readonly platformName = 'linkedin';
}

export class XAdapter extends BaseStubAdapter {
  public readonly platformName = 'x';
}
