"use client";

import { useState, type ReactNode } from "react";
import { UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  ProjectUploadDialog,
  useProjectUploadDialog,
} from "@/components/upload/project-upload-dialog";

export function SourceUploadButton({
  projectId,
  children,
  className = "w-full justify-start gap-2",
  iconClassName = "h-4 w-4",
}: {
  projectId: string;
  children?: ReactNode;
  className?: string;
  iconClassName?: string;
}) {
  const t = useTranslations("sidebar");
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const upload = useProjectUploadDialog({ projectId });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className={className}
      >
        {children ?? (
          <>
            <UploadCloud aria-hidden className={iconClassName} />
            <span className="truncate">{t("upload_source")}</span>
          </>
        )}
      </Button>
      <ProjectUploadDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) setFiles([]);
        }}
        files={files}
        uploading={upload.isUploading}
        error={upload.hasUploadError}
        onFilesChange={setFiles}
        onStart={() => {
          void upload.startUpload(files).then((result) => {
            if (result?.ok) {
              setFiles([]);
              setOpen(false);
            }
          });
        }}
      />
    </>
  );
}
