import { z } from 'zod';
import { AuthenticatedUserSchema } from './auth.js';

export const CustomerWorkspaceResponseSchema = z.object({
  principalType: z.literal('user'),
  user: AuthenticatedUserSchema,
});

export type CustomerWorkspaceResponse = z.infer<typeof CustomerWorkspaceResponseSchema>;
