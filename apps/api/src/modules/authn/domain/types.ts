export interface AuthenticatedIdentity {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
}

export interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
}
