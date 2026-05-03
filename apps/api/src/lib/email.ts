import { render } from "@react-email/render";
import { Resend } from "resend";
import {
  InviteEmail,
  ResetPasswordEmail,
  VerificationEmail,
} from "@opencairn/emails";
import type { ReactElement } from "react";

// Email transport selection.
//
// EMAIL_PROVIDER env (explicit):
//   "resend"  → Resend HTTP API (requires RESEND_API_KEY)
//   "smtp"    → nodemailer over SMTP (requires SMTP_HOST/PORT/USER/PASS)
//   "console" → log to stdout, never deliver (dev fallback)
//
// Unset: auto-detect — RESEND_API_KEY wins, then SMTP_HOST, else console in
// development. Production fails closed instead of silently printing account
// verification/reset links to server logs.
//
// Selection is computed once at module load. Process restart is required
// after changing env, which matches every other env-gated component.
type Provider = "resend" | "smtp" | "console" | "unconfigured";

const explicit = (process.env.EMAIL_PROVIDER ?? "").toLowerCase();
const provider: Provider = (() => {
  if (explicit === "resend" || explicit === "smtp" || explicit === "console") {
    return explicit;
  }
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST) return "smtp";
  if (process.env.NODE_ENV === "production") return "unconfigured";
  return "console";
})();

const from =
  process.env.EMAIL_FROM ??
  `OpenCairn <${process.env.CONTACT_EMAIL ?? "support@example.com"}>`;
const webBase = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const DEFAULT_LOCALE = "ko"; // Plan 9a default; recipient-locale 추론은 후속.

const resend =
  provider === "resend" && process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

// Lazy import keeps nodemailer out of the cold-start path when the active
// provider isn't SMTP. Cached after first call so transport sockets / DNS
// lookups are reused across send() invocations.
let smtpTransporter: import("nodemailer").Transporter | null = null;
async function getSmtpTransporter(): Promise<import("nodemailer").Transporter> {
  if (smtpTransporter) return smtpTransporter;
  // Fail-closed symmetric with the Resend branch: without SMTP_HOST,
  // nodemailer silently falls back to localhost:25 and surfaces a confusing
  // ECONNREFUSED instead of the real misconfiguration.
  if (!process.env.SMTP_HOST) {
    throw new Error(
      "EMAIL_PROVIDER=smtp but SMTP_HOST is unset. Set SMTP_HOST or switch EMAIL_PROVIDER.",
    );
  }
  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT ?? 587);
  // 465 → implicit TLS; everything else → STARTTLS upgrade per nodemailer
  // convention. SMTP_SECURE override exposed for non-standard ports
  // (e.g., self-hosted Postfix on 2525).
  smtpTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure:
      process.env.SMTP_SECURE !== undefined
        ? process.env.SMTP_SECURE === "true"
        : port === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
  });
  return smtpTransporter;
}

interface SendArgs {
  to: string;
  subject: string;
  react: ReactElement;
}

async function send({ to, subject, react }: SendArgs): Promise<void> {
  if (provider === "console") {
    // Dev / unconfigured installs: surface enough that operators know which
    // template fired and can copy the link out of logs without diffing every
    // module.
    const text = await render(react, { plainText: true });
    console.log("[email:console]", { to, subject });
    console.log(text);
    return;
  }

  if (provider === "unconfigured") {
    throw new Error(
      "Email transport is not configured in production. Set EMAIL_PROVIDER=console explicitly for log-only delivery, or configure Resend/SMTP.",
    );
  }

  if (provider === "resend") {
    if (!resend) {
      throw new Error(
        "EMAIL_PROVIDER=resend but RESEND_API_KEY is unset. Set the key or switch EMAIL_PROVIDER.",
      );
    }
    await resend.emails.send({ from, to, subject, react });
    return;
  }

  // SMTP
  const html = await render(react);
  const text = await render(react, { plainText: true });
  const transporter = await getSmtpTransporter();
  await transporter.sendMail({ from, to, subject, html, text });
}

export async function sendInviteEmail(
  to: string,
  params: { token: string; workspaceId: string; invitedByName: string },
): Promise<void> {
  // Invite link routes through signup — recipient gets a session first,
  // then the onboarding page resolves the token into an accept card.
  const signupUrl = `${webBase}/${DEFAULT_LOCALE}/auth/signup?invite=${encodeURIComponent(params.token)}`;
  const subject = `${params.invitedByName}님이 OpenCairn 워크스페이스에 초대하셨습니다`;
  await send({
    to,
    subject,
    react: InviteEmail({ inviter: params.invitedByName, signupUrl }),
  });
}

export async function sendVerificationEmail(
  to: string,
  params: { verifyUrl: string },
): Promise<void> {
  await send({
    to,
    subject: "OpenCairn 이메일 인증을 완료해 주세요",
    react: VerificationEmail({ verifyUrl: params.verifyUrl }),
  });
}

export async function sendResetPasswordEmail(
  to: string,
  params: { resetUrl: string },
): Promise<void> {
  await send({
    to,
    subject: "OpenCairn 비밀번호 재설정 안내",
    react: ResetPasswordEmail({ resetUrl: params.resetUrl }),
  });
}

// Exposed for /healthz / debug surfaces. Never log the SMTP password or the
// Resend key — just the active transport.
export function getEmailProvider(): Provider {
  return provider;
}

// Plan 2 Task 14 — generic send surface for the email-dispatcher. Unlike
// the specific `sendInviteEmail` / `sendVerificationEmail` callers, the
// dispatcher composes the subject + react element from the notification
// kind and the recipient's locale, so it needs an unbranded entry point.
export async function sendEmail(args: SendArgs): Promise<void> {
  await send(args);
}
