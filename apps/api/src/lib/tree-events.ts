// In-process event bus for the sidebar's SSE tree stream (spec §4.6.1 /
// §11.4). Folder + note CRUD handlers emit events *after* their DB commit;
// any SSE connection subscribed to that project's channel forwards them to
// the client, which then invalidates the matching React Query cache key.
//
// Only in-process — acceptable for Phase 2 because the API is a single-
// process Hono deployment. Multi-process scale-out would require Postgres
// LISTEN/NOTIFY or a message bus; document a TODO when that time comes.

import { EventEmitter } from "node:events";

export type TreeEventKind =
  | "tree.folder_created"
  | "tree.folder_renamed"
  | "tree.folder_moved"
  | "tree.folder_reordered"
  | "tree.folder_deleted"
  | "tree.note_created"
  | "tree.note_renamed"
  | "tree.note_moved"
  | "tree.note_deleted"
  | "tree.note_restored";

export interface TreeEvent {
  kind: TreeEventKind;
  projectId: string;
  id: string;                  // folder id or note id
  parentId: string | null;     // folders.parent_id or notes.folder_id
  label?: string;              // folder.name or note.title (created / renamed)
  at: string;                  // ISO timestamp
}

const bus = new EventEmitter();
// Sidebar connections for a single project keep one listener each; many
// concurrent clients against a popular project can easily cross the default
// cap of 10. Raise it well above any realistic concurrent-user ceiling.
bus.setMaxListeners(1000);

const channel = (projectId: string): string => `project:${projectId}`;

/**
 * Emit a tree event. MUST be called AFTER the mutation's DB transaction
 * commits — emitting inside a drizzle `transaction` callback risks
 * surfacing an event for a mutation that rolls back.
 */
export function emitTreeEvent(event: TreeEvent): void {
  bus.emit(channel(event.projectId), event);
}

/**
 * Subscribe to events for one project. Returns an unsubscribe function;
 * callers MUST invoke it on connection close to avoid listener leaks.
 */
export function subscribeTreeEvents(
  projectId: string,
  handler: (event: TreeEvent) => void,
): () => void {
  const ch = channel(projectId);
  bus.on(ch, handler);
  return () => {
    bus.off(ch, handler);
  };
}

/**
 * Test-only: returns the current listener count for a project's channel.
 * Used by tree-events unit tests to assert that subscribers are properly
 * cleaned up on connection abort.
 */
export function _listenerCountForTest(projectId: string): number {
  return bus.listenerCount(channel(projectId));
}
