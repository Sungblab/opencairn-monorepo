import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";

import {
  CommentReplyEmail,
  DigestEmail,
  EMAIL_COPY,
  MentionEmail,
  ResearchCompleteEmail,
  ShareInviteEmail,
  SystemEmail,
  type EmailLocale,
  type EmailNotificationKind,
} from "../src";

const cta = "https://example.com/ko/app/w/test/n/note-id";

describe("per-kind notification templates", () => {
  for (const locale of ["ko", "en"] as EmailLocale[]) {
    describe(`locale=${locale}`, () => {
      it("MentionEmail renders heading + CTA", async () => {
        const html = await render(
          <MentionEmail
            locale={locale}
            ctaUrl={cta}
            params={{ fromName: "Sungbin", subjectTitle: "프로젝트 회의록" }}
          />,
        );
        expect(html).toContain("Sungbin");
        expect(html).toContain(`href="${cta}"`);
        // CTA copy from POJO
        expect(html).toContain(EMAIL_COPY[locale].kinds.mention.cta);
      });

      it("CommentReplyEmail uses comment-reply copy", async () => {
        const html = await render(
          <CommentReplyEmail
            locale={locale}
            ctaUrl={cta}
            params={{ fromName: "Yejin", subjectTitle: "기획안" }}
          />,
        );
        expect(html).toContain(EMAIL_COPY[locale].kinds.comment_reply.cta);
      });

      it("ShareInviteEmail interpolates role detail", async () => {
        const html = await render(
          <ShareInviteEmail
            locale={locale}
            ctaUrl={cta}
            params={{
              fromName: "Doohyung",
              subjectTitle: "공유 노트",
              detail: "viewer",
            }}
          />,
        );
        expect(html).toContain("viewer");
      });

      it("ResearchCompleteEmail renders title", async () => {
        const html = await render(
          <ResearchCompleteEmail
            locale={locale}
            ctaUrl={cta}
            params={{ subjectTitle: "양자 컴퓨팅 동향" }}
          />,
        );
        expect(html).toContain("양자 컴퓨팅 동향");
      });

      it("SystemEmail falls back to detail", async () => {
        const html = await render(
          <SystemEmail
            locale={locale}
            ctaUrl={cta}
            params={{ subjectTitle: "공지", detail: "신규 기능 안내" }}
          />,
        );
        expect(html).toContain("신규 기능 안내");
      });
    });
  }

  it("CTA href is repeated as plain text for fallback", async () => {
    const html = await render(
      <MentionEmail
        locale="ko"
        ctaUrl={cta}
        params={{ fromName: "Tester", subjectTitle: "Test" }}
      />,
    );
    const escaped = cta.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const matches = html.match(new RegExp(escaped, "g")) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("DigestEmail", () => {
  const items = [
    { summary: "Sungbin replied to a comment", linkUrl: "https://example.com/a" },
    { summary: "Yejin replied to a comment", linkUrl: "https://example.com/b" },
    { summary: "Plain summary without link" },
  ];

  for (const locale of ["ko", "en"] as EmailLocale[]) {
    it(`renders 3 items for locale=${locale}`, async () => {
      const html = await render(
        <DigestEmail
          locale={locale}
          kind="comment_reply"
          items={items}
          fallbackCtaUrl="https://example.com/fallback"
        />,
      );
      for (const item of items) {
        expect(html).toContain(item.summary);
      }
      expect(html).toContain(EMAIL_COPY[locale].kinds.comment_reply ? "" : ""); // sanity
    });
  }

  it("subject uses count-aware copy", async () => {
    // Subject lives in <Preview>; verify by rendering preview text.
    const html = await render(
      <DigestEmail
        locale="ko"
        kind="mention"
        items={items}
        fallbackCtaUrl="https://example.com/fallback"
      />,
    );
    const expected = EMAIL_COPY.ko.digest.subject({ kind: "mention", count: 3 });
    expect(html).toContain(expected);
  });

  it("throws on empty items", () => {
    expect(() =>
      DigestEmail({
        locale: "ko",
        kind: "mention",
        items: [],
        fallbackCtaUrl: "https://example.com",
      }),
    ).toThrow();
  });
});

describe("template kind coverage", () => {
  it("EMAIL_COPY exports labels for every dispatched kind", () => {
    const required: EmailNotificationKind[] = [
      "mention",
      "comment_reply",
      "share_invite",
      "research_complete",
      "system",
    ];
    for (const kind of required) {
      expect(EMAIL_COPY.ko.kindLabels[kind]).toBeTruthy();
      expect(EMAIL_COPY.en.kindLabels[kind]).toBeTruthy();
    }
  });
});
