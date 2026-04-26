"use client";
import { useState } from "react";
import { ViewSwitcher } from "./ViewSwitcher";
import { ViewRenderer } from "./ViewRenderer";
import { VisualizeDialog } from "./ai/VisualizeDialog";

interface Props {
  projectId: string;
}

export function ProjectGraph({ projectId }: Props) {
  const [aiOpen, setAiOpen] = useState(false);
  return (
    <div className="flex h-full flex-col">
      <ViewSwitcher onAiClick={() => setAiOpen(true)} />
      <div className="min-h-0 flex-1">
        <ViewRenderer projectId={projectId} />
      </div>
      <VisualizeDialog
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        projectId={projectId}
      />
    </div>
  );
}
