"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { NoteHistorySheet } from "./note-history-sheet";

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

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("open")}
        title={t("open")}
        onClick={() => setOpen(true)}
      >
        <History className="size-4" aria-hidden />
      </Button>
      <NoteHistorySheet
        noteId={noteId}
        readOnly={readOnly}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
