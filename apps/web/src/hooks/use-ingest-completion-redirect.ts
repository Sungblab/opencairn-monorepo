"use client";
import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useIngestStore } from "@/stores/ingest-store";
import { urls } from "@/lib/urls";

/**
 * Auto-redirect to the workspace note URL 5 seconds after a run reaches `completed`,
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
  const params = useParams<{ wsSlug?: string }>() ?? {};
  const wsSlug = params.wsSlug;
  const cancelled = useRef(false);

  const status = run?.status ?? null;
  const noteId = run?.noteId ?? null;
  const enabled = opts.enabled !== false;
  const delay = opts.delayMs ?? 5000;

  useEffect(() => {
    if (!enabled) return;
    if (status !== "completed" || !noteId) return;
    cancelled.current = false;
    const timer = setTimeout(() => {
      if (!cancelled.current && wsSlug) {
        router.push(urls.workspace.note(locale, wsSlug, noteId));
      }
    }, delay);
    return () => {
      cancelled.current = true;
      clearTimeout(timer);
    };
  }, [status, noteId, router, delay, enabled, locale, wsSlug]);
}
