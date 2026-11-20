import { TargetPlatform, PublishPostInput } from '../types/publisher.types';
import { ZernioPlatformPayload } from '../providers/zernio/zernio.types';

export interface PlatformValidationResult {
  valid: boolean;
  errors: string[];
}

export interface IPlatformAdapter {
  readonly platformName: string;
  isSupported(): boolean;
  validateTarget(target: TargetPlatform, input: PublishPostInput): PlatformValidationResult;
  formatPayload(target: TargetPlatform, input: PublishPostInput): ZernioPlatformPayload;
}

