"use client";

interface Props {
  projectId: string;
}

export default function TimelineView({ projectId }: Props) {
  return (
    <div data-testid="timeline-view-stub" data-project-id={projectId}>
      TODO: TimelineView (Task 20)
    </div>
  );
}
