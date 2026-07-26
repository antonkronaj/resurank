/**
 * Minimal client for the Mailpit REST API (docker-compose service, :8025).
 * Lets tests assert on mail the server actually sent over SMTP rather than
 * stubbing nodemailer, so the transport is covered too.
 */
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitSummary {
  ID: string;
  To: Array<{Address: string}>;
  Subject: string;
}

export async function isMailpitRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=1`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, {method: 'DELETE'});
}

async function listMessages(): Promise<MailpitSummary[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50`);
  const body = (await response.json()) as {messages?: MailpitSummary[]};
  return body.messages ?? [];
}

/**
 * Mail is sent fire-and-forget so the HTTP response never waits on SMTP —
 * tests therefore have to poll for delivery.
 */
export async function waitForEmail(
  to: string,
  options: {subject?: RegExp; timeoutMs?: number} = {},
): Promise<{subject: string; body: string}> {
  const {subject, timeoutMs = 5000} = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const match = (await listMessages()).find(
      (message) =>
        message.To.some((recipient) => recipient.Address.toLowerCase() === to.toLowerCase()) &&
        (!subject || subject.test(message.Subject)),
    );

    if (match) {
      const response = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const detail = (await response.json()) as {Text?: string; HTML?: string};
      return {subject: match.Subject, body: detail.Text ?? detail.HTML ?? ''};
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const what = subject ? `matching ${subject} ` : '';
  throw new Error(`No email ${what}delivered to ${to} within ${timeoutMs}ms`);
}

export async function messagesFor(to: string): Promise<MailpitSummary[]> {
  const messages = await listMessages();
  return messages.filter((m) => m.To.some((r) => r.Address.toLowerCase() === to.toLowerCase()));
}

/** Pulls the first http(s) URL out of an email body. */
export function extractLink(body: string): string {
  const match = body.match(/https?:\/\/[^\s<>"')]+/);
  if (!match) throw new Error(`No link found in email body:\n${body}`);
  return match[0];
}
