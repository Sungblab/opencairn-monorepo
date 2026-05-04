"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AttachedChip } from "@opencairn/shared";

import { ChipRow } from "./ChipRow";
import { RagModeToggle, type RagModeValue } from "./RagModeToggle";

// Plan 11A — assembled chat input: chip row + rag mode toggle on top,
// textarea + send button at bottom. Disabled state piped down from the
// parent so the panel can lock the form during streaming without rolling
// its own busy/dim treatment in three places.
export function ChatInput({
  chips,
  workspaceId,
  ragMode,
  onSend,
  onAddChip,
  onRemoveChip,
  onChangeRagMode,
  disabled,
}: {
  chips: AttachedChip[];
  workspaceId: string | null;
  ragMode: RagModeValue;
  onSend: (text: string) => void;
  onAddChip: (chip: { type: AttachedChip["type"]; id: string }) => void;
  onRemoveChip: (key: string) => void;
  onChangeRagMode: (m: RagModeValue) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("chatScope.input");
  const [text, setText] = useState("");
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-background">
      <div className="flex items-center">
        <ChipRow
          chips={chips}
          workspaceId={workspaceId}
          onAdd={onAddChip}
          onRemove={onRemoveChip}
        />
        <RagModeToggle mode={ragMode} onChange={onChangeRagMode} />
      </div>
      <div className="flex items-end gap-2 p-2">
        <textarea
          className="min-h-14 flex-1 resize-none bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          rows={2}
          placeholder={t("placeholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
        />
        <button
          type="button"
          className="app-btn-primary rounded-[var(--radius-control)] px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={disabled || text.trim().length === 0}
          onClick={() => {
            onSend(text);
            setText("");
          }}
        >
          {t("send")}
        </button>
      </div>
    </div>
  );
}
