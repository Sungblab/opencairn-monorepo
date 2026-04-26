"use client";

import { useRouter, useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useNotifications } from "./use-notifications";
import { NotificationItem } from "./notification-item";
import type { NotificationRow } from "@/lib/api-client";

// Plan 2C Task 11 — click routing.
//
// The drawer lives inside ShellSidebar, which only mounts under
// /[locale]/app/w/[wsSlug]/(shell)/..., so wsSlug is always reachable via
// useParams(). The notification payload carries `noteId` but no
// projectId/wsSlug, so we route through the shell-level
// /app/w/<wsSlug>/n/<noteId> stub (same path the command palette uses for
// note jumps) and let the shell resolve the project for the full editor URL.
//
// `system` notifications get a `linkUrl` if the publisher set one — they're
// the only kind allowed to leave the app.
function notificationHref(
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
        return `/${locale}/app/w/${wsSlug}/n/${p.noteId}${fragment}`;
      }
      return null;
    case "share_invite":
    case "research_complete":
      if (typeof p.noteId === "string" && wsSlug) {
        return `/${locale}/app/w/${wsSlug}/n/${p.noteId}`;
      }
      return null;
    case "system":
      return typeof p.linkUrl === "string" ? p.linkUrl : null;
    default:
      return null;
  }
}

export function NotificationDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(v: boolean): void;
}) {
  const t = useTranslations("notifications.drawer");
  // Body lives in a child so its hooks (useNotifications → useQueryClient)
  // only run when the drawer is open. That keeps NotificationDrawer mountable
  // from contexts without a React Query provider — important for the unit
  // test that renders <SidebarFooter /> in isolation.
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px]">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        {open ? <DrawerBody onOpenChange={onOpenChange} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  onOpenChange,
}: {
  onOpenChange(v: boolean): void;
}) {
  const t = useTranslations("notifications.drawer");
  const { items, markRead } = useNotifications({ enabled: true });
  const router = useRouter();
  const locale = useLocale();
  const params = useParams<{ wsSlug?: string }>();
  const wsSlug = params?.wsSlug ?? null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        items.map((n) => (
          <NotificationItem
            key={n.id}
            item={n}
            onClick={() => {
              markRead.mutate(n.id);
              const href = notificationHref(n, locale, wsSlug);
              if (href) {
                onOpenChange(false);
                router.push(href);
              }
            }}
          />
        ))
      )}
    </div>
  );
}
