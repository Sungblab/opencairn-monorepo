import { Resend } from "resend";
import { InviteEmail } from "@opencairn/emails";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const from = process.env.EMAIL_FROM ?? "OpenCairn <hello@opencairn.com>";
const webBase = process.env.WEB_BASE_URL ?? "http://localhost:3000";
const DEFAULT_LOCALE = "ko"; // Plan 9a default; recipient-locale 추론은 후속.

export async function sendInviteEmail(
  to: string,
  params: { token: string; workspaceId: string; invitedByName: string },
): Promise<void> {
  // Invite link routes through signup — recipient gets a session first,
  // then the onboarding page resolves the token into an accept card.
  const signupUrl = `${webBase}/${DEFAULT_LOCALE}/auth/signup?invite=${encodeURIComponent(params.token)}`;
  const subject = `${params.invitedByName}님이 OpenCairn 워크스페이스에 초대하셨습니다`;

  if (!resend) {
    console.log("[email:dev]", { to, subject, signupUrl, inviter: params.invitedByName });
    return;
  }

  await resend.emails.send({
    from,
    to,
    subject,
    react: InviteEmail({ inviter: params.invitedByName, signupUrl }),
  });
}
