import type { AuditLogEntry, AuditLogPort } from '../../authz/index.js';

export class AuditRejectedError extends Error {
  readonly auditEntry: AuditLogEntry;
  readonly domainError: Error;

  constructor(auditEntry: AuditLogEntry, domainError: Error) {
    super(domainError.message);
    this.name = 'AuditRejectedError';
    this.auditEntry = auditEntry;
    this.domainError = domainError;
  }
}

export async function runWithRejectionAudit<T>(
  auditLog: AuditLogPort,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AuditRejectedError) {
      await auditLog.append(error.auditEntry);
      throw error.domainError;
    }
    throw error;
  }
}
