import * as React from "react";
import {
  Html,
  Head,
  Body,
  Container,
  Preview,
  Section,
  Text,
  Hr,
} from "react-email";
import type { ReactNode } from "react";
import { colors, fonts, spacing, layout } from "./tokens";

interface Props {
  preview: string;
  lang?: "ko" | "en";
  siteName?: string;
  contactEmail?: string;
  children: ReactNode;
}

function defaultContactEmail(): string {
  return process.env.CONTACT_EMAIL ?? "support@example.com";
}

export function Layout({
  preview,
  lang = "ko",
  siteName = "OpenCairn",
  contactEmail = defaultContactEmail(),
  children,
}: Props) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.surface, fontFamily: fonts.body, margin: 0, padding: spacing.lg }}>
        <Container style={{ backgroundColor: colors.background, maxWidth: layout.containerMaxWidth, margin: "0 auto", padding: spacing.xl, border: `1px solid ${colors.border}`, borderRadius: "8px" }}>
          <Section>
            <Text style={{ fontFamily: fonts.logo, fontSize: "20px", fontWeight: 600, color: colors.text, margin: 0 }}>
              {siteName}
            </Text>
          </Section>
          <Hr style={{ borderColor: colors.border, margin: `${spacing.lg} 0` }} />
          <Section>{children}</Section>
          <Hr style={{ borderColor: colors.border, margin: `${spacing.lg} 0` }} />
          <Section>
            <Text style={{ fontSize: "12px", color: colors.textMuted, margin: 0 }}>
              문의는 <a href={`mailto:${contactEmail}`} style={{ color: colors.link }}>{contactEmail}</a> 으로 보내주세요.
            </Text>
            <Text style={{ fontSize: "12px", color: colors.textMuted, margin: `${spacing.xs} 0 0 0` }}>
              © {new Date().getFullYear()} {siteName}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
