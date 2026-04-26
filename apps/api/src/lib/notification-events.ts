// In-process event bus for the notifications drawer's SSE channel
// (App Shell Phase 5 Task 9). Mutation sites (mentions, comments, research
// completion, share invites, system messages) call `persistAndPublish` AFTER
// their DB transaction commits — the helper inserts the notification row,
// then fans the wire-shape event out to any SSE subscriber for that user.
//
// In-process only — fine for the single-process Hono deployment today.
// Multi-process scale-out would need Postgres LISTEN/NOTIFY or a queue.
// Mirrors the convention in lib/tree-events.ts.
//
// Payload shape per kind (all kinds share `summary: string` for the
// drawer's fallback renderer):
//   mention            { summary, noteId, commentId, fromUserId }
//   comment_reply      { summary, noteId, commentId, parentCommentId, fromUserId }
//   share_invite       { summary, noteId, noteTitle, role, fromUserId }
//   research_complete  { summary, runId, noteId, projectId, topic }
//   system             { summary, level: 'info'|'warning', linkUrl? }   (wiring TBD — Super Admin)
//
// Self-notification rule: every publisher MUST skip when the target user
// equals the actor (mirrors comments.ts mention fan-out).

import { EventEmitter } from "node:events";
import { db, notifications, type Notification } from "@opencairn/db";

export type NotificationKind =
  | "mention"
  | "comment_reply"
  | "research_complete"
  | "share_invite"
  | "system";

export interface NotificationEvent {
  id: string;
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  createdAt: string;
  seenAt: string | null;
  readAt: string | null;
}

const bus = new EventEmitter();
// One listener per active SSE connection per user. Lift well above any
// realistic concurrency ceiling.
bus.setMaxListeners(1000);

const channel = (userId: string): string => `user:${userId}`;

function rowToEvent(row: Notification): NotificationEvent {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind as NotificationKind,
    payload: row.payload as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    seenAt: row.seenAt?.toISOString() ?? null,
    readAt: row.readAt?.toISOString() ?? null,
  };
}

/**
 * Insert + broadcast in a single call. Callers SHOULD invoke this AFTER the
 * triggering mutation's DB transaction commits so a rolled-back mention
 * doesn't surface a phantom notification.
 */
export async function persistAndPublish(opts: {
  userId: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
}): Promise<NotificationEvent> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: opts.userId,
      kind: opts.kind,
      payload: opts.payload,
    })
    .returning();
  const event = rowToEvent(row);
  bus.emit(channel(opts.userId), event);
  return event;
}

/**
 * Subscribe to a user's notification stream. Returns an unsubscribe; the
 * SSE handler MUST call it on abort to avoid listener leaks.
 */
export function subscribeNotifications(
  userId: string,
  handler: (event: NotificationEvent) => void,
): () => void {
  const ch = channel(userId);
  bus.on(ch, handler);
  return () => {
    bus.off(ch, handler);
  };
}

/** Test-only: listener count for a user's channel (leak assertions). */
export function _listenerCountForTest(userId: string): number {
  return bus.listenerCount(channel(userId));
}
