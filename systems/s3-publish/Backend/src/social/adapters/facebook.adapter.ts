import { IPlatformAdapter, PlatformValidationResult } from './platform-adapter.interface';
import { TargetPlatform, PublishPostInput } from '../types/publisher.types';
import { ZernioPlatformPayload } from '../providers/zernio/zernio.types';

export class FacebookAdapter implements IPlatformAdapter {
  public readonly platformName = 'facebook';

  public isSupported(): boolean {
    return true;
  }

  public validateTarget(target: TargetPlatform, input: PublishPostInput): PlatformValidationResult {
    const errors: string[] = [];

    if (!target.accountId || typeof target.accountId !== 'string' || target.accountId.trim() === '') {
      errors.push('Facebook accountId is required and cannot be empty.');
    }

    // Text posts must have a caption
    if (!input.imageUrl && (!input.caption || input.caption.trim() === '')) {
      errors.push('Caption is required for Facebook text posts.');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public formatPayload(target: TargetPlatform, _input: PublishPostInput): ZernioPlatformPayload {
    return {
      platform: 'facebook',
      accountId: target.accountId.trim(),
    };
  }
}
