import nodemailer, {type Transporter} from 'nodemailer';
import {Resend} from 'resend';
import type {FastifyBaseLogger} from 'fastify';
import {config} from '../config.js';
import {
  accountExistsEmail,
  emailChangeEmail,
  emailChangedNotice,
  passwordChangedNotice,
  passwordResetEmail,
  verificationEmail,
  type EmailTemplate,
} from './email-templates.js';

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  await send({to, ...verificationEmail(token)});
}

/**
 * Sent when someone registers with an address that already has an account.
 * Registration always responds with the same generic success message, so this
 * is what stops the endpoint from becoming a user-enumeration oracle while
 * still telling the real account holder that something happened.
 */
export async function sendAccountExistsEmail(to: string): Promise<void> {
  await send({to, ...accountExistsEmail()});
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  await send({to, ...passwordResetEmail(token)});
}

/**
 * Sent to the *new* address when a profile update requests an email change.
 * The account keeps its old address until this link is clicked.
 */
export async function sendEmailChangeEmail(to: string, token: string): Promise<void> {
  await send({to, ...emailChangeEmail(token)});
}

/**
 * Sent to the *old* address once an email change lands, so losing control of
 * an inbox is never silent.
 */
export async function sendEmailChangedNotice(to: string, newEmail: string): Promise<void> {
  await send({to, ...emailChangedNotice(newEmail)});
}

/** Sent after any password change or reset — the safety net for a takeover. */
export async function sendPasswordChangedNotice(to: string): Promise<void> {
  await send({to, ...passwordChangedNotice()});
}

/**
 * Fire-and-forget delivery. Mail is sent outside the request/response cycle on
 * purpose: a dead mail provider must never turn a successful write into a 500.
 */
export function sendInBackground(
  logger: FastifyBaseLogger,
  task: Promise<void>,
  context: string,
): void {
  task.catch((error) => logger.error({error, context}, 'failed to send email'));
}

interface Mail extends EmailTemplate {
  to: string;
}

/**
 * Two send paths, chosen once per process by whether RESEND_API_KEY is set
 * (see config.ts): Resend's HTTP API for dev/prod, or SMTP for the fallback
 * that Mailpit and the test suite rely on. Both are lazily constructed so a
 * process that never sends mail (most test files) never touches either.
 */
async function send(mail: Mail): Promise<void> {
  if (config.resend.apiKey) {
    const {error} = await getResendClient().emails.send({from: config.email.from, ...mail});
    if (error) {
      throw new Error(`Resend rejected the email to ${mail.to}: ${error.message}`);
    }
    return;
  }

  await getTransporter().sendMail({from: config.email.from, ...mail});
}

let resendClient: Resend | undefined;

function getResendClient(): Resend {
  resendClient ??= new Resend(config.resend.apiKey);
  return resendClient;
}

let transporter: Transporter | undefined;

function getTransporter(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // Port 465 is implicit TLS; 587/1025 upgrade via STARTTLS when offered.
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? {user: config.smtp.user, pass: config.smtp.pass} : undefined,
  });
  return transporter;
}
