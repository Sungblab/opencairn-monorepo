"use client";

import { LocaleAppProviders } from "@/components/providers/locale-app-providers";
import { ProfileView } from "./profile-view";

export function ProfileViewRuntime() {
  return (
    <LocaleAppProviders>
      <ProfileView />
    </LocaleAppProviders>
  );
}
