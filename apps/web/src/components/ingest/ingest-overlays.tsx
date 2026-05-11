"use client";
import { IngestNotifications } from "./ingest-notifications";

/**
 * Mounts the background ingest subscriber inside the AppShell.
 * Upload keeps the original file as the primary surface; ingest only reports
 * terminal status through toasts.
 */
export function IngestOverlays() {
  return <IngestNotifications />;
}
