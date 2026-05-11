"use client";

// Plan 2B Task 17 — avatar pile for remote collaborators on this page.
//
// Reads the Yjs awareness map exposed by `@platejs/yjs`. The `withCursors`
// helper from `@slate-yjs/core` stores our `cursors.data` payload under the
// default field key `"data"` (see cursorDataField default in
// @slate-yjs/core/dist/plugins/withCursors). So each awareness state looks
// like `{ data: { name, color }, ... }`. Local client is filtered out so the
// user doesn't see themselves in the stack.

import { YjsPlugin } from "@platejs/yjs/react";
import { useEditorRef } from "platejs/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

interface Presence {
  id: string | null;
  name: string;
  color: string;
  clientID: number;
}

interface AwarenessState {
  data?: { id?: string; name?: string; color?: string };
}

export function PresenceStack({ currentUserId }: { currentUserId: string }) {
  const editor = useEditorRef();
  const t = useTranslations("collab.presence");
  const [users, setUsers] = useState<Presence[]>([]);

  useEffect(() => {
    const awareness = editor.getOption(YjsPlugin, "awareness");
    if (!awareness) return;

    const refresh = () => {
      const states = awareness.getStates() as Map<number, AwarenessState>;
      const list: Presence[] = [];
      const seen = new Set<string>();
      states.forEach((state, clientID) => {
        // Skip self — the user already has a cursor indicator in their own
        // editor, so duplicating them in the avatar pile is noise.
        if (clientID === awareness.clientID) return;
        const d = state?.data;
        if (d?.id === currentUserId) return;
        if (d?.name) {
          const key = d.id ? `id:${d.id}` : `client:${clientID}`;
          if (seen.has(key)) return;
          seen.add(key);
          list.push({
            id: d.id ?? null,
            name: d.name,
            color: d.color ?? "#888",
            clientID,
          });
        }
      });
      setUsers(list);
    };

    refresh();
    awareness.on("change", refresh);
    return () => {
      awareness.off("change", refresh);
    };
  }, [currentUserId, editor]);

  if (users.length === 0) return null;

  return (
    <div
      className="flex items-center -space-x-2"
      aria-label={t("viewing_count", { count: users.length })}
    >
      {users.slice(0, 5).map((u) => (
        <div
          key={u.clientID}
          title={u.name}
          style={{ background: u.color }}
          className="border-background grid h-7 w-7 place-items-center rounded-full border-2 text-xs font-medium text-white"
        >
          {u.name.slice(0, 1).toUpperCase()}
        </div>
      ))}
      {users.length > 5 && (
        <span className="text-fg-muted ml-2 text-sm">+{users.length - 5}</span>
      )}
    </div>
  );
}
