"use client";

// Plan 2E Phase B-2 Task 2.5 — image drag-drop / file-paste upload.
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

const IMAGE_UPLOAD_EVENT = "opencairn:image-upload-requested";

type ImageUploadEvent = CustomEvent<{ file: File }>;

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
      const file = Array.from(dt.files).find((f) => f.type.startsWith("image/"));
      if (file) window.dispatchEvent(new CustomEvent(IMAGE_UPLOAD_EVENT, { detail: { file } }));
      return true;
    },
    onPaste: ({ event }) => {
      const items = (event as unknown as ClipboardEvent).clipboardData?.items;
      if (!items) return false;
      const item = Array.from(items).find(
        (it) => it.kind === "file" && it.type.startsWith("image/"),
      );
      if (!item) return false;
      event.preventDefault();
      const file = item.getAsFile();
      if (file) window.dispatchEvent(new CustomEvent(IMAGE_UPLOAD_EVENT, { detail: { file } }));
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
export function useImageUploadDeferredToast(
  noteId: string,
  editor: { tf: { insertNodes: (nodes: unknown, options?: unknown) => void } } | null,
) {
  const t = useTranslations("editor.image");
  useEffect(() => {
    const handler = (event: Event) => {
      const file = (event as ImageUploadEvent).detail?.file;
      if (!file || !editor) return;
      const form = new FormData();
      form.set("file", file);
      toast.promise(
        fetch(`/api/notes/${noteId}/images`, {
          method: "POST",
          credentials: "include",
          body: form,
        }).then(async (res) => {
          if (!res.ok) throw new Error(`image upload ${res.status}`);
          const body = (await res.json()) as { url: string };
          editor.tf.insertNodes(
            [
              {
                type: "image",
                url: body.url,
                alt: file.name,
                children: [{ text: "" }],
              },
              { type: "p", children: [{ text: "" }] },
            ],
            { select: true },
          );
        }),
        {
          loading: t("uploading"),
          success: t("uploaded"),
          error: t("uploadFailed"),
        },
      );
    };
    window.addEventListener(IMAGE_UPLOAD_EVENT, handler);
    return () => window.removeEventListener(IMAGE_UPLOAD_EVENT, handler);
  }, [editor, noteId, t]);
}
