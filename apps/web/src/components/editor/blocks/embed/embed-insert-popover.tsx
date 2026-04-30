"use client";

// Plan 2E Phase B — embed URL input dialog.
//
// Opened by the slash menu via onRequestPopover("embed") callback.
// Validates the URL with toEmbedUrl(); shows an inline error for
// unsupported hosts. On success, calls onInsert with the resolved
// provider + original URL + computed embedUrl.

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toEmbedUrl } from "@/lib/embeds/to-embed-url";
import type { PlateEditor } from "platejs/react";

export interface EmbedInsertResolution {
  provider: "youtube" | "vimeo" | "loom";
  url: string;
  embedUrl: string;
}

export interface EmbedInsertPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** React node that acts as the popover anchor (may be invisible). */
  anchor: React.ReactNode;
  onInsert: (resolution: EmbedInsertResolution) => void;
}

export function EmbedInsertPopover({
  open,
  onOpenChange,
  anchor,
  onInsert,
}: EmbedInsertPopoverProps) {
  const t = useTranslations("editor.embed");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const resolution = toEmbedUrl(url.trim());
    if (!resolution) {
      setError(t("unsupportedHost"));
      return;
    }
    onInsert({ ...resolution, url: url.trim() });
    setUrl("");
    setError(null);
    onOpenChange(false);
  }

  function handleCancel() {
    setUrl("");
    setError(null);
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger>{anchor}</PopoverTrigger>
      <PopoverContent className="w-[360px]">
        <form onSubmit={handleSubmit} className="space-y-2">
          <Input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            placeholder={t("urlPlaceholder")}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm">
              {t("insert")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Insert an embed node into the editor at the current selection.
 * Called from NoteEditor after the user confirms in EmbedInsertPopover.
 */
export function insertEmbedNode(
  editor: PlateEditor,
  resolution: EmbedInsertResolution,
) {
  // Batched so the embed + trailing paragraph land as one history step;
  // `select: true` parks the caret in the new paragraph (the last node)
  // so the user can keep typing without a manual click.
  editor.tf.insertNodes(
    [
      {
        type: "embed",
        provider: resolution.provider,
        url: resolution.url,
        embedUrl: resolution.embedUrl,
        children: [{ text: "" }],
      },
      { type: "p", children: [{ text: "" }] },
    ],
    { select: true },
  );
}
