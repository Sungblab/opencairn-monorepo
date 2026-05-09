// Plan 2C Task 11 — NotificationItem kind-aware summary smoke tests.
//
// Backend writes a different payload shape per kind (see
// apps/api/src/lib/notification-events.ts header comment). The drawer used
// to render `payload.summary` for everything; this suite locks in the
// per-kind formatting so a new translation key drift or a missing payload
// field surfaces immediately.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NotificationItem } from "./notification-item";

const messages = {
  notifications: {
    kindLabels: {
      mention: "멘션",
      comment_reply: "답글",
      share_invite: "공유",
      research_complete: "리서치",
      system: "알림",
    },
    summary: {
      comment_reply: "{from} 님이 답글을 남겼습니다",
      share_invite: '{from} 님이 "{note}"를 공유했습니다 ({role})',
      research_complete: '"{topic}" 리서치가 완료되었습니다',
    },
  },
};

function wrap(item: Parameters<typeof NotificationItem>[0]["item"]) {
  return render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <NotificationItem item={item} onClick={() => undefined} />
    </NextIntlClientProvider>,
  );
}

describe("NotificationItem kinds", () => {
  it("renders comment_reply with the reply body as summary", () => {
    wrap({
      id: "1",
      userId: "u1",
      kind: "comment_reply",
      payload: {
        summary: "great point",
        noteId: "n1",
        commentId: "c1",
        parentCommentId: "c0",
        fromUserId: "u2",
      },
      created_at: "2026-04-26T00:00:00Z",
      seen_at: null,
      read_at: null,
    });
    expect(screen.getByText("답글")).toBeInTheDocument();
    expect(screen.getByText(/great point/)).toBeInTheDocument();
    const item = screen.getByRole("button", { name: /great point/ });
    expect(item).toHaveClass(
      "rounded-[var(--radius-card)]",
      "border",
      "border-border",
      "bg-background",
      "hover:border-foreground",
      "hover:bg-muted/40",
    );
    expect(item).not.toHaveClass("rounded");
    expect(item.className).not.toContain("hover:bg-accent");
    expect(item.className).not.toContain("hover:bg-muted ");
  });

  it("renders share_invite with note title + role from i18n template", () => {
    wrap({
      id: "2",
      userId: "u1",
      kind: "share_invite",
      payload: {
        summary: "ignored",
        noteId: "n1",
        noteTitle: "Roadmap",
        role: "viewer",
        fromUserId: "u2",
      },
      created_at: "2026-04-26T00:00:00Z",
      seen_at: null,
      read_at: null,
    });
    expect(screen.getByText("공유")).toBeInTheDocument();
    expect(screen.getByText(/Roadmap/)).toBeInTheDocument();
  });

  it("renders research_complete with topic from i18n template", () => {
    wrap({
      id: "3",
      userId: "u1",
      kind: "research_complete",
      payload: {
        summary: "ignored",
        runId: "r1",
        noteId: "n1",
        projectId: "p1",
        topic: "AI safety",
      },
      created_at: "2026-04-26T00:00:00Z",
      seen_at: null,
      read_at: null,
    });
    expect(screen.getByText("리서치")).toBeInTheDocument();
    expect(screen.getByText(/AI safety/)).toBeInTheDocument();
  });

  it("falls back to payload.summary for system kind", () => {
    wrap({
      id: "4",
      userId: "u1",
      kind: "system",
      payload: { summary: "scheduled maintenance tonight" },
      created_at: "2026-04-26T00:00:00Z",
      seen_at: null,
      read_at: null,
    });
    expect(screen.getByText("알림")).toBeInTheDocument();
    expect(
      screen.getByText("scheduled maintenance tonight"),
    ).toBeInTheDocument();
  });
});
