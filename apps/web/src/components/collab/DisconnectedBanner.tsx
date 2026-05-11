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
import { useCallback, useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

interface ProviderHandle {
  connect?: () => void;
  isConnected?: boolean;
}

const DISCONNECTED_BANNER_GRACE_MS = 1200;

export function DisconnectedBanner() {
  const editor = useEditorRef();
  const t = useTranslations("collab.collab");
  const isConnected = usePluginOption(YjsPlugin, "_isConnected");
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (isConnected) {
      setShowBanner(false);
      return;
    }
    const timer = window.setTimeout(
      () => setShowBanner(true),
      DISCONNECTED_BANNER_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [isConnected]);

  const handleRetry = useCallback(() => {
    const providers = editor.getOption(YjsPlugin, "_providers") as
      | ProviderHandle[]
      | undefined;
    providers?.forEach((p) => p.connect?.());
  }, [editor]);

  if (isConnected || !showBanner) return null;

  return (
    <div
      role="status"
      className="mx-auto mt-3 flex w-[calc(100%-2rem)] max-w-[720px] flex-col items-stretch justify-between gap-2 rounded-[var(--radius-control)] border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive shadow-sm sm:flex-row sm:items-center"
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <WifiOff aria-hidden className="h-4 w-4 shrink-0" />
        <span className="truncate">{t("disconnected_banner")}</span>
      </span>
      <button
        type="button"
        className="min-h-8 shrink-0 rounded-[var(--radius-control)] border border-destructive/25 px-2.5 text-sm font-medium transition-colors hover:bg-destructive/10"
        onClick={handleRetry}
      >
        {t("restore_connection")}
      </button>
    </div>
  );
}
