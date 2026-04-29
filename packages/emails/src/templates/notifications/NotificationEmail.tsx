import * as React from "react";
import { Text } from "react-email";

import { Layout } from "../../components/Layout";
import { Button } from "../../components/Button";
import { colors, spacing } from "../../components/tokens";
import {
  EMAIL_COPY,
  type EmailLocale,
  type EmailNotificationKind,
  type KindCopyParams,
} from "../../locale";

// Single shared notification template body — every per-kind template below
// (MentionEmail, CommentReplyEmail, ...) is a thin wrapper that fills in
// `kind` and `params`. Centralizes the layout so design changes don't
// drift across 5 files.

export interface NotificationEmailProps {
  locale: EmailLocale;
  kind: EmailNotificationKind;
  /** Absolute URL for the CTA button. The dispatcher composes this. */
  ctaUrl: string;
  /** Copy params consumed by EMAIL_COPY[locale].kinds[kind].* functions. */
  params?: KindCopyParams;
}

export function NotificationEmail({
  locale,
  kind,
  ctaUrl,
  params = {},
}: NotificationEmailProps) {
  const copy = EMAIL_COPY[locale].kinds[kind];
  return (
    <Layout preview={copy.subject(params)} lang={locale}>
      <Text
        style={{
          fontSize: "18px",
          color: colors.text,
          fontWeight: 600,
          margin: `0 0 ${spacing.md} 0`,
        }}
      >
        {copy.heading(params)}
      </Text>
      <Text
        style={{
          fontSize: "15px",
          color: colors.text,
          lineHeight: "22px",
          margin: `0 0 ${spacing.lg} 0`,
        }}
      >
        {copy.body(params)}
      </Text>
      <Button href={ctaUrl}>{copy.cta}</Button>
      <Text
        style={{
          fontSize: "12px",
          color: colors.textMuted,
          margin: `${spacing.xl} 0 0 0`,
          wordBreak: "break-all",
        }}
      >
        {ctaUrl}
      </Text>
    </Layout>
  );
}

// Per-kind named exports — keep external callsites readable
// (`MentionEmail({...})` reads better than `<NotificationEmail kind="mention" ...>`).
export const MentionEmail = (
  props: Omit<NotificationEmailProps, "kind">,
) => <NotificationEmail {...props} kind="mention" />;
export const CommentReplyEmail = (
  props: Omit<NotificationEmailProps, "kind">,
) => <NotificationEmail {...props} kind="comment_reply" />;
export const ShareInviteEmail = (
  props: Omit<NotificationEmailProps, "kind">,
) => <NotificationEmail {...props} kind="share_invite" />;
export const ResearchCompleteEmail = (
  props: Omit<NotificationEmailProps, "kind">,
) => <NotificationEmail {...props} kind="research_complete" />;
export const SystemEmail = (
  props: Omit<NotificationEmailProps, "kind">,
) => <NotificationEmail {...props} kind="system" />;
