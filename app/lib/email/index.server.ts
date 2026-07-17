/**
 * E-mail provider abstraction (SPEC §7). Resend is the first implementation; the
 * interface allows swapping providers by adding a case here. With no provider
 * configured the app runs in honest degraded mode: senders are unavailable and
 * callers must surface that state — never pretend an e-mail was delivered.
 */

import { log } from "../log.server";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ ok: true } | { ok: false; error: string }>;
}

class ResendProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const body = await response.text();
        log.error("email.send_failed", { provider: this.name, status: response.status });
        return { ok: false, error: `Provider responded ${response.status}: ${body.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (error) {
      log.error("email.send_failed", {
        provider: this.name,
        errorCode: error instanceof Error ? error.name : "UnknownError",
      });
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
}

/** Null when no provider is configured (degraded mode). */
export function getEmailProvider(env: Env): EmailProvider | null {
  if (!env.RESEND_API_KEY) return null;
  return new ResendProvider(env.RESEND_API_KEY, `${env.APP_NAME} <${env.SUPPORT_EMAIL}>`);
}

export function isEmailConfigured(env: Env): boolean {
  return getEmailProvider(env) !== null;
}
