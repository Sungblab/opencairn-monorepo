import * as React from "react";
import { Text, Section, Hr } from "react-email";

import { Layout } from "../../components/Layout";
import { Button } from "../../components/Button";
import { colors, spacing } from "../../components/tokens";
import {
  EMAIL_COPY,
  type EmailLocale,
  type EmailNotificationKind,
} from "../../locale";

export interface DigestItem {
  /** Plain-text summary (already sanitized at insert time per notification-events contract). */
  summary: string;
  /** Absolute URL — same composition rule as instant CTAs. */
  linkUrl?: string;
}

export interface DigestEmailProps {
  locale: EmailLocale;
  kind: EmailNotificationKind;
  items: DigestItem[];
  /** Fallback CTA when no item has a linkUrl. */
  fallbackCtaUrl: string;
}

export function DigestEmail({
  locale,
  kind,
  items,
  fallbackCtaUrl,
}: DigestEmailProps) {
  if (items.length === 0) {
    // Caller guarantees non-empty; rendering empty would surface a confusing
    // "0 items" subject. Throw early so the dispatcher catches the bug
    // instead of mailing an empty digest.
    throw new Error("DigestEmail received an empty items array");
  }
  const copy = EMAIL_COPY[locale];
  const digest = copy.digest;
  const count = items.length;

  return (
    <Layout preview={digest.subject({ kind, count })} lang={locale}>
      <Text
        style={{
          fontSize: "18px",
          color: colors.text,
          fontWeight: 600,
          margin: `0 0 ${spacing.md} 0`,
        }}
      >
        {digest.heading({ kind, count })}
      </Text>
      <Text
        style={{
          fontSize: "13px",
          color: colors.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          margin: `0 0 ${spacing.sm} 0`,
        }}
      >
        {copy.kindLabels[kind]}
      </Text>
      <Text
        style={{
          fontSize: "15px",
          color: colors.text,
          lineHeight: "22px",
          margin: `0 0 ${spacing.lg} 0`,
        }}
      >
        {digest.intro({ kind, count })}
      </Text>

      {items.map((item, idx) => (
        <Section key={idx} style={{ margin: `0 0 ${spacing.md} 0` }}>
          <Text
            style={{
              fontSize: "14px",
              color: colors.text,
              margin: 0,
              lineHeight: "20px",
            }}
          >
            <span style={{ color: colors.textMuted, marginRight: spacing.xs }}>
              {digest.itemSeparator}
            </span>
            {item.linkUrl ? (
              <a
                href={item.linkUrl}
                style={{ color: colors.link, textDecoration: "none" }}
              >
                {item.summary}
              </a>
            ) : (
              item.summary
            )}
          </Text>
        </Section>
      ))}

      <Hr style={{ borderColor: colors.border, margin: `${spacing.lg} 0` }} />
      <Button href={items[0]?.linkUrl ?? fallbackCtaUrl}>{digest.cta}</Button>
    </Layout>
  );
}
