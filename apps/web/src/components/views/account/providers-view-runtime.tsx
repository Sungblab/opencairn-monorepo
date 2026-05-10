"use client";

import { LocaleAppProviders } from "@/components/providers/locale-app-providers";
import { ProvidersView } from "./providers-view";

export function ProvidersViewRuntime() {
  return (
    <LocaleAppProviders>
      <ProvidersView />
    </LocaleAppProviders>
  );
}
