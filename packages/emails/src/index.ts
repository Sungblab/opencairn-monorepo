export { Layout } from "./components/Layout";
export { Button } from "./components/Button";
export { InviteEmail } from "./templates/invite";
export { VerificationEmail } from "./templates/verification";
export { ResetPasswordEmail } from "./templates/reset-password";

// Plan 2 Task 14 — notification email templates.
export {
  NotificationEmail,
  MentionEmail,
  CommentReplyEmail,
  ShareInviteEmail,
  ResearchCompleteEmail,
  SystemEmail,
  type NotificationEmailProps,
} from "./templates/notifications/NotificationEmail";
export {
  DigestEmail,
  type DigestEmailProps,
  type DigestItem,
} from "./templates/notifications/DigestEmail";
export {
  EMAIL_COPY,
  type EmailLocale,
  type EmailNotificationKind,
  type EmailCopy,
  type KindCopy,
  type KindCopyParams,
  type DigestCopy,
} from "./locale";
