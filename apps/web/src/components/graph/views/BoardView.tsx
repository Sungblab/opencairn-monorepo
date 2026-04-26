"use client";

interface Props {
  projectId: string;
  root?: string;
}

export default function BoardView({ projectId, root }: Props) {
  return (
    <div data-testid="board-view-stub" data-project-id={projectId}>
      TODO: BoardView (Task 21) root={root ?? "none"}
    </div>
  );
}
