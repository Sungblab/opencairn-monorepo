"use client";

// Plan 2E Phase B-2 — Image URL input popover.
//
// Opened by the slash menu via onRequestPopover("image") callback.
// Validates URL with imageElementSchema.shape.url; shows inline error for
// invalid URLs. On success, calls onInsert with url/alt/caption data.

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { imageElementSchema } from "@opencairn/shared";
import type { PlateEditor } from "platejs/react";

export interface ImageInsertData {
  url: string;
  alt?: string;
  caption?: string;
}

export interface ImageInsertPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** React node that acts as the popover anchor (may be invisible). */
  anchor: React.ReactNode;
  onInsert: (data: ImageInsertData) => void;
}

export function ImageInsertPopover({
  open,
  onOpenChange,
  anchor,
  onInsert,
}: ImageInsertPopoverProps) {
  const t = useTranslations("editor.image");
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = imageElementSchema.shape.url.safeParse(url.trim());
    if (!parsed.success) {
      setError(t("invalidUrl"));
      return;
    }
    onInsert({
      url: url.trim(),
      alt: alt.trim() || undefined,
      caption: caption.trim() || undefined,
    });
    setUrl("");
    setAlt("");
    setCaption("");
    setError(null);
    onOpenChange(false);
  }

  function handleCancel() {
    setUrl("");
    setAlt("");
    setCaption("");
    setError(null);
    onOpenChange(false);
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger>{anchor}</PopoverTrigger>
      <PopoverContent className="w-[420px]">
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
          <Input
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder={t("altPlaceholder")}
          />
          <Input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t("captionPlaceholder")}
          />
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
 * Insert an image node into the editor at the current selection.
 * Called from NoteEditor after the user confirms in ImageInsertPopover.
 */
export function insertImageNode(editor: PlateEditor, data: ImageInsertData) {
  editor.tf.insertNodes({
    type: "image",
    url: data.url,
    ...(data.alt ? { alt: data.alt } : {}),
    ...(data.caption ? { caption: data.caption } : {}),
    children: [{ text: "" }],
  });
  // Insert an empty paragraph after the void so the caret isn't trapped.
  editor.tf.insertNodes({ type: "p", children: [{ text: "" }] });
}
