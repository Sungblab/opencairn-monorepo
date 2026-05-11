"use client";
import { useEffect } from "react";
import { IngestEvent } from "@opencairn/shared";
import { useIngestStore } from "@/stores/ingest-store";

type StreamEntry = {
  es: EventSource;
  refs: number;
  closed: boolean;
  staleTimer: ReturnType<typeof setTimeout> | null;
};

const streams = new Map<string, StreamEntry>();
const STALE_RECONNECT_MS = 30_000;

function closeStream(wfid: string, entry: StreamEntry) {
  clearStaleTimer(entry);
  if (!entry.closed) {
    entry.closed = true;
    entry.es.close();
  }
  if (streams.get(wfid) === entry) {
    streams.delete(wfid);
  }
}

function clearStaleTimer(entry: StreamEntry) {
  if (entry.staleTimer) {
    clearTimeout(entry.staleTimer);
    entry.staleTimer = null;
  }
}

function restartStream(wfid: string, entry: StreamEntry) {
  if (entry.closed || streams.get(wfid) !== entry) return;
  entry.es.close();
  entry.es = new EventSource(`/api/ingest/stream/${wfid}`, {
    withCredentials: true,
  });
  attachHandlers(wfid, entry);
}

function attachHandlers(wfid: string, entry: StreamEntry) {
  entry.es.onopen = () => {
    clearStaleTimer(entry);
  };
  entry.es.onmessage = (msg) => {
    clearStaleTimer(entry);
    try {
      const parsed = IngestEvent.parse(JSON.parse(msg.data));
      useIngestStore.getState().applyEvent(wfid, parsed);
      if (parsed.kind === "completed" || parsed.kind === "failed") {
        closeStream(wfid, entry);
      }
    } catch (e) {
      console.warn("[ingest-stream] parse failed", e);
    }
  };
  entry.es.onerror = () => {
    // EventSource should auto-reconnect on transient failures. If it stays in
    // CONNECTING/CLOSED long enough, recycle the physical connection while
    // preserving the ref-counted subscription entry.
    if (entry.staleTimer || entry.closed) return;
    entry.staleTimer = setTimeout(() => {
      entry.staleTimer = null;
      if (streams.get(wfid) !== entry || entry.closed) return;
      if (
        entry.es.readyState === EventSource.CONNECTING ||
        entry.es.readyState === EventSource.CLOSED
      ) {
        if (entry.refs > 0) {
          restartStream(wfid, entry);
        } else {
          closeStream(wfid, entry);
        }
      }
    }, STALE_RECONNECT_MS);
  };
}

/**
 * Subscribe to /api/ingest/stream/:wfid via EventSource. Re-runs on wfid
 * change. EventSource handles auto-reconnect natively (the browser sends
 * Last-Event-ID = the id field of the last received message); the API
 * handler dedupes via that header. Multiple UI surfaces can ask for the same
 * workflow, but only one physical EventSource is kept open.
 */
export function useIngestStream(wfid: string | null): void {
  useEffect(() => {
    if (!wfid) return;
    if (typeof EventSource === "undefined") return;

    let entry = streams.get(wfid);
    if (!entry || entry.closed) {
      const url = `/api/ingest/stream/${wfid}`;
      const es = new EventSource(url, { withCredentials: true });
      const newEntry: StreamEntry = {
        es,
        refs: 0,
        closed: false,
        staleTimer: null,
      };
      entry = newEntry;
      streams.set(wfid, newEntry);
      attachHandlers(wfid, newEntry);
    }

    const stream = entry;
    stream.refs += 1;

    return () => {
      const current = streams.get(wfid);
      if (current !== stream) return;
      current.refs -= 1;
      if (current.refs <= 0) {
        closeStream(wfid, current);
      }
    };
  }, [wfid]);
}
