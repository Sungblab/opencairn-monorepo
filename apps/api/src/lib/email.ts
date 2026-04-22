import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const from = process.env.EMAIL_FROM ?? "OpenCairn <onboarding@resend.dev>";
const webBase = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const DEFAULT_LOCALE = "ko"; // Plan 9a default; recipient-locale 추론은 후속.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function sendInviteEmail(
  to: string,
  params: { token: string; workspaceId: string; invitedByName: string },
): Promise<void> {
  // Invite link routes through signup — recipient gets a session first,
  // then the onboarding page resolves the token into an accept card.
  const signupUrl = `${webBase}/${DEFAULT_LOCALE}/auth/signup?invite=${encodeURIComponent(params.token)}`;
  const safeName = escapeHtml(params.invitedByName);
  const subject = `${safeName} invited you to a workspace on OpenCairn`;
  const html = `<p>${safeName} invited you to collaborate.</p>
<p><a href="${signupUrl}">Accept invite</a></p>`;

  if (!resend) {
    console.log("[email:dev]", { to, subject, signupUrl });
    return;
  }
  await resend.emails.send({ from, to, subject, html });
}
