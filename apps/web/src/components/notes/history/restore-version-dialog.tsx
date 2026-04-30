"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RestoreVersionDialogProps {
  open: boolean;
  version: number | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  labels: {
    title: string;
    body: string;
    cancel: string;
    restore: string;
    pending: string;
  };
}

export function RestoreVersionDialog({
  open,
  version,
  pending,
  onOpenChange,
  onConfirm,
  labels,
}: RestoreVersionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {labels.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending || version === null}
          >
            {pending ? labels.pending : labels.restore}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
