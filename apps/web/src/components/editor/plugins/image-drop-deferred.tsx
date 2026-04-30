"use client";

// Plan 2E Phase B-2 Task 2.5 — deferred image drag-drop / file-paste toast.
//
// The upload pipeline (MinIO, presigned URLs, MIME checks) is its own future
// plan (see spec § 3.4 / § 10). Until then, intercepting File payloads with
// image/* MIME types shows a sonner toast pointing the user at "use a URL
// for now". No node is inserted.
//
// Implementation note: `useTranslations` is a React hook and cannot be called
// inside a Plate plugin handler (not a component). We solve this by dispatching
// a window custom event from the handler and listening for it in a hook that
// lives inside the NoteEditor component body — where hooks are allowed.

import { useEffect } from "react";
import { createPlatePlugin } from "platejs/react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

const DEFERRED_EVENT = "opencairn:image-upload-deferred";

/** Plate plugin that intercepts image File drops and file-pastes. */
export const imageDropDeferredPlugin = createPlatePlugin({
  key: "image-drop-deferred",
  handlers: {
    onDrop: ({ event }) => {
      const dt = (event as unknown as DragEvent).dataTransfer;
      if (!dt || dt.files.length === 0) return false;
      const hasImageFile = Array.from(dt.files).some((f) =>
        f.type.startsWith("image/"),
      );
      if (!hasImageFile) return false;
      event.preventDefault();
      window.dispatchEvent(new CustomEvent(DEFERRED_EVENT));
      return true;
    },
    onPaste: ({ event }) => {
      const items = (event as unknown as ClipboardEvent).clipboardData?.items;
      if (!items) return false;
      const hasImageFile = Array.from(items).some(
        (it) => it.kind === "file" && it.type.startsWith("image/"),
      );
      if (!hasImageFile) return false;
      event.preventDefault();
      window.dispatchEvent(new CustomEvent(DEFERRED_EVENT));
      return true;
    },
  },
});

/**
 * Hook installed in NoteEditor. Listens for the custom event dispatched
 * by imageDropDeferredPlugin and shows a translated sonner toast.
 * Splitting this from the plugin handler avoids the "hook inside a
 * non-component" problem.
 */
export function useImageUploadDeferredToast() {
  const t = useTranslations("editor.image");
  useEffect(() => {
    const handler = () => toast.info(t("uploadDeferred"));
    window.addEventListener(DEFERRED_EVENT, handler);
    return () => window.removeEventListener(DEFERRED_EVENT, handler);
  }, [t]);
}
