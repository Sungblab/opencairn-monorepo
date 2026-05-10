"use client";

import { LocaleAppProviders } from "@/components/providers/locale-app-providers";
import { McpSettingsClient } from "./McpSettingsClient";

type McpSettingsClientRuntimeProps = {
  mcpClientEnabled?: boolean;
  mcpServerEnabled?: boolean;
};

export function McpSettingsClientRuntime(
  props: McpSettingsClientRuntimeProps,
) {
  return (
    <LocaleAppProviders>
      <McpSettingsClient {...props} />
    </LocaleAppProviders>
  );
}
