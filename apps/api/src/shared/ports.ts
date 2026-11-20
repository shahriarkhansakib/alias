export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailerPort {
  sendEmail(message: EmailMessage): Promise<void>;
}

/**
 * Opaque transaction handle passed from UnitOfWork into repository ports
 * so domain and application layers never depend on Drizzle or pg types.
 */
export interface TransactionContext {
  readonly __brand: unique symbol;
}

export interface UnitOfWork {
  runInTransaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
  runWithAdvisoryLock<T>(lockKey: bigint, fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}
