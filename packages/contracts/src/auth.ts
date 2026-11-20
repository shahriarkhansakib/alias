import { z } from 'zod';

export const AuthenticatedUserSchema = z.object({
  userId: z.uuid(),
  sessionId: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  emailVerified: z.boolean(),
  mfaEnabled: z.boolean(),
});

export type AuthenticatedUser = z.infer<typeof AuthenticatedUserSchema>;

export const MeResponseSchema = z.object({
  user: AuthenticatedUserSchema,
});

export type MeResponse = z.infer<typeof MeResponseSchema>;
