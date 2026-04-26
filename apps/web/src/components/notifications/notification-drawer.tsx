"use client";

import { useTranslations } from "next-intl";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useNotifications } from "./use-notifications";
import { NotificationItem } from "./notification-item";

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
        {open ? <DrawerBody /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody() {
  const t = useTranslations("notifications.drawer");
  const { items, markRead } = useNotifications({ enabled: true });
  return (
    <div className="mt-4 flex flex-col gap-2">
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("empty")}</p>
      ) : (
        items.map((n) => (
          <NotificationItem
            key={n.id}
            item={n}
            onClick={() => markRead.mutate(n.id)}
          />
        ))
      )}
    </div>
  );
}
