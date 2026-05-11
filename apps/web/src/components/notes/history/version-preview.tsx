"use client";

import { PlateStaticRenderer } from "@/components/share/plate-static-renderer";
import type { NoteVersionDetail } from "@/lib/api-client-note-versions";

interface VersionPreviewProps {
  version: NoteVersionDetail | undefined;
  loading: boolean;
  error: boolean;
  labels: {
    loading: string;
    loadFailed: string;
    selectVersion: string;
  };
}

export function VersionPreview({
  version,
  loading,
  error,
  labels,
}: VersionPreviewProps) {
  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">{labels.loading}</div>
    );
  }
  if (error) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {labels.loadFailed}
      </div>
    );
  }
  if (!version) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {labels.selectVersion}
      </div>
    );
  }

  return (
    <div className="app-scrollbar-thin min-h-0 flex-1 overflow-auto p-6">
      <h2 className="mb-4 text-lg font-semibold">{version.title}</h2>
      <PlateStaticRenderer
        value={Array.isArray(version.content) ? version.content : []}
      />
    </div>
  );
}
