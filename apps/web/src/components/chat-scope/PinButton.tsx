"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pin } from "lucide-react";
import type { PinDelta } from "@opencairn/shared";

import { PinPermissionModal } from "./PinPermissionModal";

// Plan 11A — pin button + warning flow. The button targets a specific
// (noteId, blockId) on a specific assistant message; if the API returns
// 409 with a delta payload the modal opens and the user explicitly takes
// responsibility before the /pin/confirm twin route runs.
export function PinButton({
  messageId,
  targetNoteId,
  targetBlockId,
}: {
  messageId: string;
  targetNoteId: string;
  targetBlockId: string;
}) {
  const t = useTranslations("chatScope.pin");
  const [pinned, setPinned] = useState(false);
  const [warning, setWarning] = useState<PinDelta | null>(null);

  async function pin(confirm = false): Promise<void> {
    const url = confirm
      ? `/api/chat/messages/${messageId}/pin/confirm`
      : `/api/chat/messages/${messageId}/pin`;
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ noteId: targetNoteId, blockId: targetBlockId }),
    });
    if (res.status === 200) {
      setPinned(true);
      setWarning(null);
      return;
    }
    if (res.status === 409) {
      const body = (await res.json()) as { warning: PinDelta };
      setWarning(body.warning);
      return;
    }
    // Other failure modes (403/404/500) fall through silently — the user
    // sees no state change. Toast surfacing is owned by the chat panel
    // wrapper in Task 11.
  }

  return (
    <>
      <button
        type="button"
        aria-label={t("button")}
        className="app-btn-ghost inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1.5 py-1 text-sm text-muted-foreground"
        onClick={() => void pin(false)}
        disabled={pinned}
      >
        <Pin size={14} />
        <span>{pinned ? t("pinned") : t("button")}</span>
      </button>
      {warning && (
        <PinPermissionModal
          warning={warning}
          onCancel={() => setWarning(null)}
          onConfirm={() => void pin(true)}
        />
      )}
    </>
  );
}
