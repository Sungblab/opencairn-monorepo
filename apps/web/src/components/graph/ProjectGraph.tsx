"use client";
import GraphView from "./views/GraphView";

export function ProjectGraph({ projectId }: { projectId: string }) {
  return <GraphView projectId={projectId} />;
}
