"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import type { Tab } from "@/stores/tabs-store";
import type { ReadingViewerBodyProps } from "./reading-viewer-body";

const LazyReadingViewerBody = dynamic<ReadingViewerBodyProps>(
  () =>
    import("./reading-viewer-body").then((mod) => mod.ReadingViewerBody),
  { ssr: false, loading: () => <ReadingViewerBodySkeleton /> },
);

type NoteMeta = ReadingViewerBodyProps["note"];
type Me = ReadingViewerBodyProps["me"];

export function ReadingViewer({ tab }: { tab: Tab }) {
  const t = useTranslations("appShell.viewers.reading");
  const [size, setSize] = useState(16);

  const { data: note } = useQuery<NoteMeta>({
    queryKey: ["note-meta", tab.targetId],
    enabled: !!tab.targetId,
    queryFn: async () => {
      const r = await fetch(`/api/notes/${tab.targetId}`);
      if (!r.ok) throw new Error(`note ${r.status}`);
      return (await r.json()) as NoteMeta;
    },
  });

  const { data: me } = useQuery<Me>({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me");
      if (!r.ok) throw new Error(`me ${r.status}`);
      return (await r.json()) as Me;
    },
  });

  if (!tab.targetId) return null;
  if (!note || !me) {
    return (
      <div
        data-testid="reading-viewer"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        ...
      </div>
    );
  }

  return (
    <LazyReadingViewerBody
      tab={tab}
      note={note}
      me={me}
      size={size}
      setSize={setSize}
      label={{ fontSize: t("fontSize") }}
    />
  );
}

function ReadingViewerBodySkeleton() {
  return (
    <div
      data-testid="reading-viewer"
      className="flex h-full items-center justify-center text-sm text-muted-foreground"
    >
      ...
    </div>
  );
}
