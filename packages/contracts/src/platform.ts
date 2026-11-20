import { z } from 'zod';
import { PlatformRoleKeySchema } from './access.js';

export const PlatformAdminStatusSchema = z.enum(['active', 'revoked']);

export type PlatformAdminStatus = z.infer<typeof PlatformAdminStatusSchema>;

export const PlatformStatusResponseSchema = z.object({
  status: z.literal('operational'),
  service: z.string(),
  database: z.literal('connected'),
  activeAdminCount: z.number().int().min(0),
  requirePlatformMfa: z.boolean(),
  actor: z.object({
    userId: z.uuid(),
    email: z.email(),
    roleKey: PlatformRoleKeySchema,
  }),
  timestamp: z.string(),
});

export type PlatformStatusResponse = z.infer<typeof PlatformStatusResponseSchema>;
export const PlatformStatusDtoSchema = PlatformStatusResponseSchema;
export type PlatformStatusDto = PlatformStatusResponse;

export const PlatformAdminItemSchema = z.object({
  assignmentId: z.uuid(),
  userId: z.uuid(),
  email: z.email(),
  name: z.string(),
  roleKey: PlatformRoleKeySchema,
  status: PlatformAdminStatusSchema,
  mfaEnabled: z.boolean(),
  createdAt: z.string(),
});

export type PlatformAdminItem = z.infer<typeof PlatformAdminItemSchema>;

export const ListPlatformAdminsResponseSchema = z.object({
  admins: z.array(PlatformAdminItemSchema),
});

export type ListPlatformAdminsResponse = z.infer<typeof ListPlatformAdminsResponseSchema>;

export const ProvisionPlatformAdminRequestSchema = z.object({
  email: z.email().trim().toLowerCase(),
  roleKey: z.literal('platform_admin').default('platform_admin'),
  reason: z.string().trim().min(1).max(240).optional(),
});

export type ProvisionPlatformAdminRequest = z.infer<typeof ProvisionPlatformAdminRequestSchema>;

export const ProvisionPlatformAdminResponseSchema = z.object({
  admin: PlatformAdminItemSchema,
});

export type ProvisionPlatformAdminResponse = z.infer<typeof ProvisionPlatformAdminResponseSchema>;

export const UpdatePlatformSecuritySettingsRequestSchema = z.object({
  requirePlatformMfa: z.boolean(),
});

export type UpdatePlatformSecuritySettingsRequest = z.infer<
  typeof UpdatePlatformSecuritySettingsRequestSchema
>;

export const PlatformSecuritySettingsDtoSchema = z.object({
  requirePlatformMfa: z.boolean(),
  updatedAt: z.string(),
  updatedByUserId: z.uuid().nullable(),
});

export type PlatformSecuritySettingsDto = z.infer<typeof PlatformSecuritySettingsDtoSchema>;
