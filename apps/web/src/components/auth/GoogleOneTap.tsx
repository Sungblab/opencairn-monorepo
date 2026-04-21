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
    client.oneTap({
      fetchOptions: {
        onSuccess: () => router.push(`/${locale}/app`),
      },
    });
  }, [router, locale]);

  return null;
}
