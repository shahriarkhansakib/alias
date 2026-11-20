import nodemailer from 'nodemailer';
import type { MailerPort } from '../ports.js';

export interface NodemailerConfig {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  user?: string;
  pass?: string;
  /** SMTP timeouts in milliseconds. Unset values keep Nodemailer's defaults (2 min, 30 s, 10 min). */
  timeouts?: {
    connectionMs?: number;
    greetingMs?: number;
    socketMs?: number;
  };
}

/** Short timeouts for local development, so a missing SMTP server fails within seconds. */
export const DEVELOPMENT_SMTP_TIMEOUTS = {
  connectionMs: 5_000,
  greetingMs: 5_000,
  socketMs: 10_000,
} as const;

export function createNodemailerMailer(config: NodemailerConfig): MailerPort {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: config.timeouts?.connectionMs,
    greetingTimeout: config.timeouts?.greetingMs,
    socketTimeout: config.timeouts?.socketMs,
    auth:
      config.user && config.pass
        ? {
            user: config.user,
            pass: config.pass,
          }
        : undefined,
  });

  return {
    async sendEmail(message) {
      await transporter.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}
