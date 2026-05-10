"use client";

import { LocaleAppProviders } from "@/components/providers/locale-app-providers";
import { NotificationsView } from "./notifications-view";

export function NotificationsViewRuntime() {
  return (
    <LocaleAppProviders>
      <NotificationsView />
    </LocaleAppProviders>
  );
}
