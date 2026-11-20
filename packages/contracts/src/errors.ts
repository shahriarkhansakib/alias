import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'PLATFORM_MFA_REQUIRED',
  'PLATFORM_ADMIN_CUSTOMER_ACCESS_DENIED',
  'SUPER_ADMIN_ALREADY_EXISTS',
  'USER_NOT_VERIFIED',
  'USER_ALREADY_ADMIN',
  'MFA_SETUP_REQUIRED_BEFORE_ENFORCEMENT',
  'CSRF_ORIGIN_INVALID',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ApiErrorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

export const ApiErrorBodySchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.array(ApiErrorDetailSchema).optional(),
  requestId: z.string(),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const ApiErrorEnvelopeSchema = z.object({
  error: ApiErrorBodySchema,
});

export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;
