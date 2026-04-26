"use client";

import { useTranslations } from "next-intl";
import type { NotificationRow } from "@/lib/api-client";

// Plan 2C Task 11 — kind-aware summary picker.
//
// Backend writes a different payload shape per kind (see
// apps/api/src/lib/notification-events.ts header):
//
//   mention            { summary, ... }
//   comment_reply      { summary, noteId, commentId, parentCommentId, fromUserId }
//   share_invite       { summary, noteId, noteTitle, role, fromUserId }
//   research_complete  { summary, runId, noteId, projectId, topic }
//   system             { summary, ... }
//
// `payload.summary` is always present (backend writes a server-rendered
// fallback string), so it acts as the universal fallback when a structured
// field we'd prefer to format locally is missing. This keeps the drawer
// readable even if a future kind ships before its renderer.
function pickSummary(
  item: NotificationRow,
  tSummary: ReturnType<typeof useTranslations>,
): string {
  const p = item.payload as Record<string, unknown>;
  const fallback = typeof p.summary === "string" ? p.summary : `[${item.kind}]`;

  switch (item.kind) {
    case "comment_reply":
      // The reply body is what the recipient cares about; backend writes it
      // into payload.summary so we surface that directly. Future iteration
      // could format `{from} replied: {body}` once we have the author name.
      return fallback;
    case "share_invite":
      if (typeof p.noteTitle === "string" && typeof p.role === "string") {
        return tSummary("share_invite", {
          from:
            typeof p.fromUserId === "string" ? p.fromUserId.slice(0, 8) : "",
          note: p.noteTitle,
          role: p.role,
        });
      }
      return fallback;
    case "research_complete":
      if (typeof p.topic === "string") {
        return tSummary("research_complete", { topic: p.topic });
      }
      return fallback;
    case "mention":
    case "system":
    default:
      return fallback;
  }
}

export function NotificationItem({
  item,
  onClick,
}: {
  item: NotificationRow;
  onClick: () => void;
}) {
  const tLabel = useTranslations("notifications.kindLabels");
  const tSummary = useTranslations("notifications.summary");
  const summary = pickSummary(item, tSummary);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col items-start gap-1 rounded border border-border p-2 text-left text-sm transition-colors hover:bg-accent ${
        item.read_at ? "opacity-60" : ""
      }`}
    >
      <span className="text-[10px] uppercase text-muted-foreground">
        {tLabel(item.kind)}
      </span>
      <span className="line-clamp-2 break-words">{summary}</span>
      <span className="text-[10px] text-muted-foreground">
        {new Date(item.created_at).toLocaleString()}
      </span>
    </button>
  );
}
