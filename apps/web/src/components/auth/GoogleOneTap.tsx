"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { authClient } from "@/lib/auth-client";

// authClient is typed as the base return type; oneTapClient plugin adds
// .oneTap() at runtime. Cast here to call it without widening the export type.
const client = authClient as typeof authClient & {
  oneTap: (opts?: {
    fetchOptions?: {
      onSuccess?: () => void;
      onError?: (ctx: { error: Error }) => void;
    };
  }) => Promise<void>;
};

export function GoogleOneTap() {
  const router = useRouter();
  const locale = useLocale();

  useEffect(() => {
    // FedCM frequently rejects on localhost with NetworkError even when the
    // OAuth client is configured — it needs a public HTTPS origin + proper
    // permissions policy. The regular Google button still works, so we just
    // skip One Tap on local dev to keep the console clean.
    if (
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1")
    ) {
      return;
    }

    void client.oneTap({
      fetchOptions: {
        onSuccess: () => router.push(`/${locale}/app`),
        // Swallow — dismissal, blocked third-party cookies, or multiple
        // signed-in accounts all surface here as non-actionable noise.
        onError: () => {},
      },
    });
  }, [router, locale]);

  return null;
}
