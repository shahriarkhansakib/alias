import dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  zernioApiKey: string;
  zernioBaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  ownerSetupToken: string;
  clientUrl: string;
  publicTrackingBaseUrl: string;
}

export const config: AppConfig = {
  get port() {
    return parseInt(process.env.PORT || '3000', 10);
  },
  get nodeEnv() {
    return process.env.NODE_ENV || 'development';
  },
  get zernioApiKey() {
    return process.env.ZERNIO_API_KEY || '';
  },
  get zernioBaseUrl() {
    return process.env.ZERNIO_BASE_URL || 'https://zernio.com/api/v1';
  },
  get jwtSecret() {
    return process.env.JWT_SECRET || 'dev-secret-change-in-production';
  },
  get jwtExpiresIn() {
    return process.env.JWT_EXPIRES_IN || '7d';
  },
  get ownerSetupToken() {
    return process.env.OWNER_SETUP_TOKEN || '';
  },
  get clientUrl() {
    return process.env.CLIENT_URL || '';
  },
  get publicTrackingBaseUrl() {
    return process.env.PUBLIC_TRACKING_BASE_URL || '';
  },
};

export function getAllowedOrigins(): string[] {
  const envOrigins = config.clientUrl
    ? config.clientUrl.split(',').map((o) => o.trim()).filter(Boolean)
    : [];

  if (config.nodeEnv === 'production') {
    return envOrigins;
  }

  return Array.from(new Set(['http://localhost:5173', ...envOrigins]));
}

export function validateConfig(): void {
  if (!config.zernioBaseUrl) {
    throw new Error('ZERNIO_BASE_URL environment variable is required.');
  }
  if (config.jwtSecret === 'dev-secret-change-in-production' && config.nodeEnv === 'production') {
    console.warn('[WARN] JWT_SECRET is using the default dev value in production. Please set a strong JWT_SECRET.');
  }
  if (config.nodeEnv === 'production') {
    if (!config.publicTrackingBaseUrl) {
      throw new Error(
        'PUBLIC_TRACKING_BASE_URL is required in production and must be a valid public HTTPS URL (e.g., https://trk.yourdomain.com).'
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(config.publicTrackingBaseUrl);
    } catch {
      throw new Error(`PUBLIC_TRACKING_BASE_URL '${config.publicTrackingBaseUrl}' is not a valid URL.`);
    }
    if (parsed.protocol !== 'https:') {
      throw new Error(`PUBLIC_TRACKING_BASE_URL must use HTTPS in production. Received: ${config.publicTrackingBaseUrl}`);
    }
  }
}

