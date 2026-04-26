"use client";

interface Props {
  projectId: string;
  root?: string;
}

export default function MindmapView({ projectId, root }: Props) {
  return (
    <div data-testid="mindmap-view-stub" data-project-id={projectId}>
      TODO: MindmapView (Task 18) root={root ?? "none"}
    </div>
  );
}
