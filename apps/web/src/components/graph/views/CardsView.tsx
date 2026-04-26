"use client";

interface Props {
  projectId: string;
}

export default function CardsView({ projectId }: Props) {
  return (
    <div data-testid="cards-view-stub" data-project-id={projectId}>
      TODO: CardsView (Task 19)
    </div>
  );
}
