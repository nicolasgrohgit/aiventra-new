// Thin outbound-mail wrapper, following the exact "inert until configured" shape already used
// for Sentry (server.ts, SENTRY_DSN) and Google Places (lib/google-places-client.ts,
// GOOGLE_PLACES_API_KEY): this codebase has zero real email infrastructure today (no
// nodemailer/SendGrid/SES dependency, no mail-relay credentials) — see the "Need a real email
// server on GCP" item in CHANGELOG.md / docs/gcp-migration.md, a separate not-yet-actionable
// infra item this file deliberately does not attempt to solve.
//
// Until a mail relay is actually configured (checked here via SMTP_URL — swap in whatever the
// eventual relay needs, e.g. a SendGrid/SES API key, when that lands), sendMail() is a safe
// no-op: it logs what it would have sent and resolves `{ sent: false }`, never throws. Callers
// (currently just POST /api/suggestions in server.ts) treat that identically to a real send
// failure — the underlying record is already durably saved regardless of email outcome, so a
// caller should never let this block or fail the request it's attached to. Once a real relay
// exists, only this function's body needs a real implementation — no caller changes.
export interface SendMailResult {
  sent: boolean;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(message: MailMessage): Promise<SendMailResult> {
  if (!process.env.SMTP_URL) {
    console.log('[mailer] No mail relay configured (SMTP_URL unset) — would have sent:', {
      to: message.to,
      subject: message.subject
    });
    return { sent: false };
  }

  // Real implementation goes here once SMTP_URL (or an equivalent relay credential) is set —
  // deliberately not stubbed out further than this, since the exact library/API depends on
  // whichever relay the GCP email-server roadmap item lands on.
  try {
    console.log('[mailer] SMTP_URL is set but no real send implementation exists yet — would have sent:', {
      to: message.to,
      subject: message.subject
    });
    return { sent: false };
  } catch (err) {
    console.warn('[mailer] send failed:', err);
    return { sent: false };
  }
}
