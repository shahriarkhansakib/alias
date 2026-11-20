import { IPlatformAdapter } from '../adapters/platform-adapter.interface';
import { FacebookAdapter } from '../adapters/facebook.adapter';
import { InstagramAdapter, LinkedInAdapter, XAdapter } from '../adapters/future-adapters';
import { TargetPlatform, PublishPostInput } from '../types/publisher.types';
import { ZernioPlatformPayload } from '../providers/zernio/zernio.types';

export class PlatformRouter {
  private adapters: Map<string, IPlatformAdapter> = new Map();

  constructor() {
    this.registerAdapter(new FacebookAdapter());
    this.registerAdapter(new InstagramAdapter());
    this.registerAdapter(new LinkedInAdapter());
    this.registerAdapter(new XAdapter());
  }

  public registerAdapter(adapter: IPlatformAdapter): void {
    this.adapters.set(adapter.platformName.toLowerCase(), adapter);
  }

  public getAdapter(platformName: string): IPlatformAdapter | undefined {
    return this.adapters.get(platformName.toLowerCase());
  }

  public isPlatformSupported(platformName: string): boolean {
    const adapter = this.getAdapter(platformName);
    return !!adapter && adapter.isSupported();
  }

  public validatePlatforms(
    platforms: TargetPlatform[],
    input: PublishPostInput
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return { valid: false, errors: ['At least one target platform must be specified.'] };
    }

    for (const target of platforms) {
      if (!target.platform || typeof target.platform !== 'string') {
        errors.push('Each target platform item must specify a "platform" string.');
        continue;
      }

      const adapter = this.getAdapter(target.platform);
      if (!adapter || !adapter.isSupported()) {
        errors.push(`Platform '${target.platform}' is not supported.`);
        continue;
      }

      const validation = adapter.validateTarget(target, input);
      if (!validation.valid) {
        errors.push(...validation.errors);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public formatPlatformTargets(
    platforms: TargetPlatform[],
    input: PublishPostInput
  ): ZernioPlatformPayload[] {
    return platforms.map((target) => {
      const adapter = this.getAdapter(target.platform);
      if (!adapter) {
        throw new Error(`Unsupported platform '${target.platform}'`);
      }
      return adapter.formatPayload(target, input);
    });
  }
}
