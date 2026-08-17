import {config} from '../config.js';

/** Text/HTML bodies for every transactional email — send()-shaped, minus `to`. */
export interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

function layout(heading: string, body: string, action?: {label: string; url: string}): string {
  const button = action
    ? `<p style="margin:24px 0"><a href="${action.url}" style="background:#2f81f7;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${action.label}</a></p>
       <p style="color:#6e7781;font-size:13px">Or paste this into your browser:<br><span style="word-break:break-all">${action.url}</span></p>`
    : '';
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;color:#1f2328;line-height:1.5">
  <h1 style="font-size:20px;margin:0 0 16px">${heading}</h1>
  ${body}
  ${button}
  <hr style="border:none;border-top:1px solid #d0d7de;margin:32px 0 16px">
  <p style="color:#6e7781;font-size:12px;margin:0">ResuRank — resume scoring that runs on your device.</p>
</div>`;
}

export function verificationEmail(token: string): EmailTemplate {
  const url = `${config.publicUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Verify your ResuRank email',
    text: `Welcome to ResuRank.\n\nConfirm your email address to activate your account:\n${url}\n\nThis link expires in 24 hours. If you didn't create an account, you can ignore this message.`,
    html: layout(
      'Welcome to ResuRank',
      `<p>Confirm your email address to activate your account.</p>
       <p style="color:#6e7781;font-size:13px">This link expires in 24 hours. If you didn't create an account, you can ignore this message.</p>`,
      {label: 'Verify email', url},
    ),
  };
}

/**
 * Sent when someone registers with an address that already has an account.
 * Registration always responds with the same generic success message, so this
 * is what stops the endpoint from becoming a user-enumeration oracle while
 * still telling the real account holder that something happened.
 */
export function accountExistsEmail(): EmailTemplate {
  const url = `${config.publicUrl}/forgot-password`;
  return {
    subject: 'You already have a ResuRank account',
    text: `Someone just tried to sign up with this email address, but you already have a ResuRank account.\n\nIf that was you, sign in instead — or reset your password:\n${url}\n\nIf it wasn't, no action is needed. Your account is unchanged.`,
    html: layout(
      'You already have an account',
      `<p>Someone just tried to sign up with this email address, but an account already exists.</p>
       <p>If that was you, sign in instead — or reset your password below. If it wasn't, no action is needed and your account is unchanged.</p>`,
      {label: 'Reset password', url},
    ),
  };
}

export function passwordResetEmail(token: string): EmailTemplate {
  const url = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Reset your ResuRank password',
    text: `Reset your ResuRank password:\n${url}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, you can ignore this message.`,
    html: layout(
      'Reset your password',
      `<p>Choose a new password for your ResuRank account.</p>
       <p style="color:#6e7781;font-size:13px">This link expires in 1 hour and can only be used once. If you didn't request it, you can ignore this message.</p>`,
      {label: 'Reset password', url},
    ),
  };
}

/**
 * Sent to the *new* address when a profile update requests an email change.
 * The account keeps its old address until this link is clicked.
 */
export function emailChangeEmail(token: string): EmailTemplate {
  const url = `${config.publicUrl}/api/auth/confirm-email-change?token=${encodeURIComponent(token)}`;
  return {
    subject: 'Confirm your new ResuRank email',
    text: `Confirm this address to finish moving your ResuRank account to it:\n${url}\n\nUntil you do, your account keeps its current email address. This link expires in 24 hours.`,
    html: layout(
      'Confirm your new email',
      `<p>Confirm this address to finish moving your ResuRank account to it.</p>
       <p style="color:#6e7781;font-size:13px">Until you do, your account keeps its current email address. This link expires in 24 hours.</p>`,
      {label: 'Confirm email', url},
    ),
  };
}

/**
 * Sent to the *old* address once an email change lands, so losing control of
 * an inbox is never silent.
 */
export function emailChangedNotice(newEmail: string): EmailTemplate {
  return {
    subject: 'Your ResuRank email address was changed',
    text: `The email address on your ResuRank account was changed to ${newEmail}.\n\nIf you did not do this, contact us immediately — this address can no longer sign in.`,
    html: layout(
      'Your email address was changed',
      `<p>The email address on your ResuRank account was changed to <b>${newEmail}</b>.</p>
       <p style="color:#6e7781;font-size:13px">If you did not do this, contact us immediately — this address can no longer sign in to the account.</p>`,
    ),
  };
}

/** Sent after any password change or reset — the safety net for a takeover. */
export function passwordChangedNotice(): EmailTemplate {
  const url = `${config.publicUrl}/forgot-password`;
  return {
    subject: 'Your ResuRank password was changed',
    text: `Your ResuRank password was just changed, and every other signed-in device was signed out.\n\nIf this wasn't you, reset your password right away:\n${url}`,
    html: layout(
      'Your password was changed',
      `<p>Your ResuRank password was just changed, and every other signed-in device was signed out.</p>
       <p style="color:#6e7781;font-size:13px">If this wasn't you, reset your password right away.</p>`,
      {label: 'Reset password', url},
    ),
  };
}
