"use client";

import type { AttachedChip } from "@opencairn/shared";

import { AddChipCombobox } from "./AddChipCombobox";
import { Chip } from "./Chip";

// Plan 11A — horizontal chip row above the chat input. The combobox sits
// inline so the "+" button keeps the chips' baseline alignment without
// pushing the textarea down.
export function ChipRow({
  chips,
  workspaceId,
  onAdd,
  onRemove,
}: {
  chips: AttachedChip[];
  workspaceId: string | null;
  onAdd: (chip: { type: AttachedChip["type"]; id: string }) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-stone-200 px-2 py-1">
      {chips.map((c) => (
        <Chip key={`${c.type}:${c.id}`} chip={c} onRemove={onRemove} />
      ))}
      <AddChipCombobox workspaceId={workspaceId} onAdd={onAdd} />
    </div>
  );
}
