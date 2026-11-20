import { OpenAPIHono } from '@hono/zod-openapi';
import { ValidationError } from '../errors.js';
import type { AppEnv } from './types.js';

export function createOpenAPIApp() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        }));
        throw new ValidationError('Request validation failed', details);
      }
    },
  });
}
