"use client";

import { LocaleAppProviders } from "@/components/providers/locale-app-providers";
import { ByokKeyCard } from "./ByokKeyCard";

export function ByokKeyCardRuntime() {
  return (
    <LocaleAppProviders>
      <ByokKeyCard />
    </LocaleAppProviders>
  );
}
