import { z } from 'zod';
import { AuthenticatedUserSchema } from './auth.js';

export const PrincipalTypeSchema = z.enum(['admin', 'user']);

export type PrincipalType = z.infer<typeof PrincipalTypeSchema>;

export const PlatformRoleKeySchema = z.enum(['super_admin', 'platform_admin']);

export type PlatformRoleKey = z.infer<typeof PlatformRoleKeySchema>;

export const AccessContextResponseSchema = z.object({
  principalType: PrincipalTypeSchema,
  platformRoleKey: PlatformRoleKeySchema.nullable(),
  requirePlatformMfa: z.boolean(),
  mfaRequired: z.boolean(),
  user: AuthenticatedUserSchema,
});

export type AccessContextResponse = z.infer<typeof AccessContextResponseSchema>;

export const AccessContextDtoSchema = AccessContextResponseSchema;
export type AccessContextDto = AccessContextResponse;
