import type { ApiErrorDetail, ErrorCode } from '@alias/contracts';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: ApiErrorDetail[];

  constructor(options: {
    code: ErrorCode;
    message: string;
    statusCode: number;
    details?: ApiErrorDetail[];
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: ApiErrorDetail[]) {
    super({ code: 'VALIDATION_ERROR', message, statusCode: 400, details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super({ code: 'UNAUTHORIZED', message, statusCode: 401 });
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'Access denied',
    code: ErrorCode = 'FORBIDDEN',
    details?: ApiErrorDetail[],
  ) {
    super({ code, message, statusCode: 403, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code: ErrorCode = 'NOT_FOUND') {
    super({ code, message, statusCode: 404 });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code: ErrorCode = 'CONFLICT') {
    super({ code, message, statusCode: 409 });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super({ code: 'RATE_LIMITED', message, statusCode: 429 });
  }
}

export class InternalError extends AppError {
  constructor(message = 'Internal server error', cause?: unknown) {
    super({ code: 'INTERNAL_ERROR', message, statusCode: 500, cause });
  }
}
