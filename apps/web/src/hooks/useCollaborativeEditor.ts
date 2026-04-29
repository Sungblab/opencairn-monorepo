"use client";

// Plan 2B Task 16 — thin wrapper around `@platejs/yjs/react` that wires a
// Hocuspocus provider for a single note (`page:<noteId>`). The Yjs document
// is canonical; the server derives `notes.content` JSON snapshots via the
// `y.XmlFragment ↔ Plate` bridge on the Hocuspocus side (see
// apps/hocuspocus/src/plate-bridge.ts).
//
// API reference: `YjsPlugin` is a PlatePlugin whose `options` field carries
// `providers` + `cursors` (see node_modules/@platejs/yjs/dist/react/index.d.ts).
// We configure via `.configure({ ... })`, which is standard Plate v49 pattern.
//
// Initialization: `editor.getApi(YjsPlugin).yjs.init({ id, value, autoSelect })`
// must be called AFTER mount (not during `usePlateEditor`), hence the
// `skipInitialization` flag + `useEffect` below.

import * as React from "react";
import { YjsPlugin } from "@platejs/yjs/react";
import { type AnyPluginConfig } from "platejs";
import { type PlateEditor, usePlateEditor } from "platejs/react";

export interface CollabUser {
  id: string;
  name: string;
  /** CSS color string — used for remote cursor caret + selection tint. */
  color: string;
}

export interface UseCollaborativeEditorArgs {
  noteId: string;
  user: CollabUser;
  readOnly: boolean;
  /** Existing Plate plugins (basic marks, lists, wiki-link, slash, LaTeX…). */
  basePlugins: AnyPluginConfig[];
}

export function useCollaborativeEditor({
  noteId,
  user,
  readOnly,
  basePlugins,
}: UseCollaborativeEditorArgs): PlateEditor {
  const editor = usePlateEditor(
    {
      plugins: [
        ...basePlugins,
        YjsPlugin.configure({
          options: {
            cursors: {
              data: { name: user.name, color: user.color },
            },
            providers: [
              {
                type: "hocuspocus",
                options: {
                  name: `page:${noteId}`,
                  url:
                    process.env.NEXT_PUBLIC_HOCUSPOCUS_URL ??
                    "ws://localhost:1234",
                  // S1-002 — the AUTH-message handshake only fires when this
                  // string is non-empty, so an empty token historically left
                  // `onAuthenticate` un-invoked and the connection in an
                  // unauthenticated state. The Better Auth session cookie is
                  // httpOnly so it's not readable from `document.cookie`;
                  // emit `document.cookie` (any non-httpOnly fragments) plus
                  // a sentinel so the handshake fires, and let the server
                  // fall back to the WS upgrade Cookie header — which DOES
                  // include the httpOnly session — for actual verification.
                  // Cross-origin deployments must swap this for a short-lived
                  // token + matching server validation path.
                  token:
                    typeof document !== "undefined"
                      ? document.cookie || "ws-auth-fallback"
                      : "ws-auth-fallback",
                },
              },
            ],
          },
        }),
      ],
      skipInitialization: true,
      readOnly,
    },
    // Re-create editor when note changes — YjsPlugin's provider is bound to
    // the noteId channel and cannot be swapped in place. `readOnly` also
    // affects editor.tf.* bindings so we rebuild for that too.
    [noteId, readOnly],
  );

  React.useEffect(() => {
    // `yjs.init` sets up the SharedType + awareness and, when the provider
    // is empty, seeds with `value`. After the server-side `onLoadDocument`
    // hook rebuilds the Y.Doc from `notes.content` the seed value is ignored.
    const api = editor.getApi(YjsPlugin).yjs;
    void api.init({
      id: `page:${noteId}`,
      autoSelect: "end",
      value: [{ type: "p", children: [{ text: "" }] }],
    });
    return () => {
      // Tear down the providers on unmount so a fresh mount (e.g. after
      // navigating to another note) doesn't leak a stale WS.
      editor.getApi(YjsPlugin).yjs.destroy();
    };
  }, [editor, noteId]);

  return editor;
}

/**
 * Stable per-user cursor color. Deterministic so a user sees the same color
 * across sessions — useful for quickly recognising collaborators without
 * needing to also render the name badge.
 */
export function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}
