"use client";
import { useEffect } from "react";
import { IngestEvent } from "@opencairn/shared";
import { useIngestStore } from "@/stores/ingest-store";

/**
 * Subscribe to /api/ingest/stream/:wfid via EventSource. Re-runs on wfid
 * change. EventSource handles auto-reconnect natively (the browser sends
 * Last-Event-ID = the id field of the last received message); the API
 * handler dedupes via that header.
 */
export function useIngestStream(wfid: string | null): void {
  const applyEvent = useIngestStore((s) => s.applyEvent);

  useEffect(() => {
    if (!wfid) return;
    const url = `/api/ingest/stream/${wfid}`;
    const es = new EventSource(url, { withCredentials: true });

    es.onmessage = (msg) => {
      try {
        const parsed = IngestEvent.parse(JSON.parse(msg.data));
        applyEvent(wfid, parsed);
        if (parsed.kind === "completed" || parsed.kind === "failed") {
          es.close();
        }
      } catch (e) {
        console.warn("[ingest-stream] parse failed", e);
      }
    };
    es.onerror = () => {
      // Let EventSource auto-reconnect on transient failures. The server
      // closes the connection on terminal events, which surfaces here too;
      // we tolerate a single onerror without manual close.
    };

    return () => es.close();
  }, [wfid, applyEvent]);
}
