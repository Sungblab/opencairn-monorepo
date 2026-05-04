"use client";

// Plan 2B Task 17 — surfaces loss of WS connection to Hocuspocus with a
// manual retry. `@platejs/yjs` tracks connection state in the plugin's
// `_isConnected` option (toggled by the onConnect/onDisconnect callbacks
// wired by the hocuspocus provider wrapper). `usePluginOption` subscribes
// reactively, so this component re-renders as status flips.
//
// The wrapper exposed at `editor.getOption(YjsPlugin, '_providers')[0]` has
// `.connect()` / `.disconnect()` methods; calling `.connect()` triggers
// reconnection. The Hocuspocus client also has its own auto-retry, so this
// button is mainly a user-facing "poke" to try immediately.

import { YjsPlugin } from "@platejs/yjs/react";
import { useEditorRef, usePluginOption } from "platejs/react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

interface ProviderHandle {
  connect?: () => void;
  isConnected?: boolean;
}

export function DisconnectedBanner() {
  const editor = useEditorRef();
  const t = useTranslations("collab.collab");
  const isConnected = usePluginOption(YjsPlugin, "_isConnected");

  const handleRetry = useCallback(() => {
    const providers = editor.getOption(YjsPlugin, "_providers") as
      | ProviderHandle[]
      | undefined;
    providers?.forEach((p) => p.connect?.());
  }, [editor]);

  if (isConnected) return null;

  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/10 text-destructive flex flex-col items-stretch justify-between gap-2 border-b px-4 py-2 text-sm sm:flex-row sm:items-center"
    >
      <span>{t("disconnected_banner")}</span>
      <button
        type="button"
        className="min-h-9 shrink-0 rounded border border-destructive/30 px-3 text-sm font-medium transition-colors hover:bg-destructive/10"
        onClick={handleRetry}
      >
        {t("restore_connection")}
      </button>
    </div>
  );
}
