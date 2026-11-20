import type { PlatformRoleAssignmentStatus, PlatformRoleKey } from '../../authz/index.js';

export const SUPER_ADMIN_BOOTSTRAP_LOCK_KEY = 420001001n;

export interface PlatformAdminRosterItem {
  assignmentId: string;
  userId: string;
  email: string;
  name: string;
  roleKey: PlatformRoleKey;
  status: PlatformRoleAssignmentStatus;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface PlatformStatusSummary {
  status: 'operational';
  service: string;
  database: 'connected';
  activeAdminCount: number;
  requirePlatformMfa: boolean;
  actor: {
    userId: string;
    email: string;
    roleKey: PlatformRoleKey;
  };
  timestamp: string;
}

export interface BootstrapSuperAdminResult {
  outcome: 'created' | 'already_bootstrapped';
  assignmentId: string;
  userId: string;
  email: string;
}

export interface ProvisionPlatformAdminInput {
  actorUserId: string;
  actorRoleKey: PlatformRoleKey;
  email: string;
  roleKey: 'platform_admin';
  reason?: string;
  requestId: string | null;
}

export interface UpdatePlatformSecuritySettingsInput {
  actorUserId: string;
  actorMfaEnabled: boolean;
  requirePlatformMfa: boolean;
  requestId: string | null;
}

export interface PlatformSecuritySettingsResult {
  requirePlatformMfa: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
}
