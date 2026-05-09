"use client";

import { urls } from "@/lib/urls";
import { useRouter, useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useNotifications } from "./use-notifications";
import { NotificationItem } from "./notification-item";
import type { NotificationRow } from "@/lib/api-client";

export function notificationHref(
  item: NotificationRow,
  locale: string,
  wsSlug: string | null,
): string | null {
  const p = item.payload as Record<string, unknown>;
  switch (item.kind) {
    case "mention":
    case "comment_reply":
      if (typeof p.noteId === "string" && wsSlug) {
        const fragment =
          typeof p.commentId === "string" ? `#comment-${p.commentId}` : "";
        return `${urls.workspace.note(locale, wsSlug, p.noteId)}${fragment}`;
      }
      return null;
    case "share_invite":
    case "research_complete":
      if (typeof p.noteId === "string" && wsSlug) {
        return urls.workspace.note(locale, wsSlug, p.noteId);
      }
      return null;
    case "system":
      return typeof p.linkUrl === "string" ? p.linkUrl : null;
    default:
      return null;
  }
}

export function NotificationListPanel({
  enabled = true,
  onNavigate,
}: {
  enabled?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations("notifications.drawer");
  const { items, markRead } = useNotifications({ enabled });
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ wsSlug?: string }>();
  const wsSlug = params?.wsSlug ?? null;

  return (
    <div className="flex flex-col gap-2 p-4">
      {items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        items.map((n) => (
          <NotificationItem
            key={n.id}
            item={n}
            onClick={() => {
              markRead.mutate(n.id);
              const href = notificationHref(n, locale, wsSlug);
              if (href) {
                onNavigate?.();
                router.push(href);
              }
            }}
          />
        ))
      )}
    </div>
  );
}
