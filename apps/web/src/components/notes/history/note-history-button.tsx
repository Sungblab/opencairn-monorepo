"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { NoteHistorySheetLoader } from "./note-history-sheet-loader";

interface NoteHistoryButtonProps {
  noteId: string;
  readOnly: boolean;
}

export function NoteHistoryButton({
  noteId,
  readOnly,
}: NoteHistoryButtonProps) {
  const t = useTranslations("noteHistory");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) setMounted(true);
    setOpen(nextOpen);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("open")}
        title={t("open")}
        onClick={() => handleOpenChange(true)}
      >
        <History className="size-4" aria-hidden />
      </Button>
      {mounted ? (
        <NoteHistorySheetLoader
          noteId={noteId}
          readOnly={readOnly}
          open={open}
          onOpenChange={handleOpenChange}
        />
      ) : null}
    </>
  );
}
