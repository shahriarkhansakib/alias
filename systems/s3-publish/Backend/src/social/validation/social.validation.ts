import { z } from 'zod';

export const targetPlatformSchema = z.object({
  platform: z.string().min(1, 'Platform name is required.'),
  accountId: z.string().min(1, 'Account ID is required.'),
});

export const publishPostSchema = z.object({
  caption: z.string().optional(),
  imageUrl: z.string().url('Invalid image URL format').optional().or(z.literal('')).nullable(),
  platforms: z.array(targetPlatformSchema).min(1, 'At least one platform must be specified.'),
  publishNow: z.boolean().optional(),
  scheduledFor: z.string().optional(),
  scheduledAt: z.string().optional(),
  timezone: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export type PublishPostDTO = z.infer<typeof publishPostSchema>;
