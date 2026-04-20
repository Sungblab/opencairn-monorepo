import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const from = process.env.EMAIL_FROM ?? "OpenCairn <onboarding@resend.dev>";
const appUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:4000";

export async function sendInviteEmail(
  to: string,
  params: { token: string; workspaceId: string; invitedByName: string },
): Promise<void> {
  const acceptUrl = `${appUrl}/api/invites/${params.token}/accept`;
  const subject = `${params.invitedByName} invited you to a workspace on OpenCairn`;
  const html = `<p>${params.invitedByName} invited you to collaborate.</p>
<p><a href="${acceptUrl}">Accept invite</a></p>`;

  if (!resend) {
    console.log("[email:dev]", { to, subject, acceptUrl });
    return;
  }
  await resend.emails.send({ from, to, subject, html });
}
