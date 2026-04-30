"use client";
import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useIngestStore } from "@/stores/ingest-store";

/**
 * Auto-redirect to the workspace note route 5 seconds after completion,
 * unless cancelled (component unmount, opts.enabled = false).
 *
 * The ref-based cancellation guard handles fast unmount cycles where the
 * cleanup runs *after* the timer has fired but before navigation lands.
 */
export function useIngestCompletionRedirect(
  wfid: string | null,
  opts: { delayMs?: number; enabled?: boolean } = {},
) {
  const run = useIngestStore((s) => (wfid ? s.runs[wfid] : null));
  const router = useRouter();
  const locale = useLocale();
  const { wsSlug } = useParams<{ wsSlug?: string }>();
  const cancelled = useRef(false);

  const status = run?.status ?? null;
  const noteId = run?.noteId ?? null;
  const enabled = opts.enabled !== false;
  const delay = opts.delayMs ?? 5000;

  useEffect(() => {
    if (!enabled) return;
    if (status !== "completed" || !noteId || !wsSlug) return;
    cancelled.current = false;
    const timer = setTimeout(() => {
      if (!cancelled.current) router.push(`/${locale}/app/w/${wsSlug}/n/${noteId}`);
    }, delay);
    return () => {
      cancelled.current = true;
      clearTimeout(timer);
    };
  }, [status, noteId, wsSlug, router, locale, delay, enabled]);
}
