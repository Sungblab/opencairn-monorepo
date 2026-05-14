"use client";

import { useRef, useState } from "react";
import { DownloadCloud } from "lucide-react";
import { useTranslations } from "next-intl";

import { useCurrentProjectContext } from "@/components/sidebar/use-current-project";
import {
  ProjectUploadDialog,
  useProjectUploadDialog,
} from "@/components/upload/project-upload-dialog";
import { dataTransferHasFiles } from "@/lib/project-tree-dnd";

export function ProjectMainDropZone({
  children,
}: {
  children: React.ReactNode;
}) {
  const { projectId } = useCurrentProjectContext();
  const tUpload = useTranslations("sidebar.upload");
  const upload = useProjectUploadDialog({ projectId });
  const [active, setActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const depthRef = useRef(0);

  return (
    <div
      className="relative flex min-h-0 flex-1"
      onDragEnter={(event) => {
        if (!projectId || !dataTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        depthRef.current += 1;
        setActive(true);
      }}
      onDragOver={(event) => {
        if (!projectId || !dataTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!projectId || !dataTransferHasFiles(event.dataTransfer)) return;
        depthRef.current = Math.max(0, depthRef.current - 1);
        if (depthRef.current === 0) setActive(false);
      }}
      onDrop={(event) => {
        if (!projectId || !dataTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        depthRef.current = 0;
        setActive(false);
        setFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {children}
      {active ? (
        <div
          data-testid="app-shell-upload-overlay"
          className="pointer-events-none absolute inset-3 z-50 grid place-items-center rounded-[var(--radius-card)] border-2 border-dashed border-foreground bg-background/90 text-center shadow-sm"
        >
          <div className="flex max-w-sm flex-col items-center gap-2 px-6">
            <DownloadCloud aria-hidden className="h-8 w-8 text-foreground" />
            <p className="text-sm font-semibold text-foreground">
              {tUpload("dropMain")}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">
              {tUpload("hint")}
            </p>
          </div>
        </div>
      ) : null}
      <ProjectUploadDialog
        open={files.length > 0}
        files={files}
        uploading={upload.isUploading}
        error={upload.hasUploadError}
        onOpenChange={(open) => {
          if (!open) setFiles([]);
        }}
        onFilesChange={setFiles}
        onStart={() => {
          void upload.startUpload(files).then((result) => {
            if (result?.ok) setFiles([]);
          });
        }}
      />
    </div>
  );
}
