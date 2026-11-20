import type { AccessContextResponse } from '@alias/contracts';

export interface HttpAuthenticatedIdentity {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
}

export type AppVariables = {
  requestId: string;
  auth?: HttpAuthenticatedIdentity;
  accessContext?: AccessContextResponse;
};

export type AppEnv = {
  Variables: AppVariables;
};
