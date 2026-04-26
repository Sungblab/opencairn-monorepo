"use client";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { ViewType } from "@opencairn/shared";

const GraphView = dynamic(() => import("./views/GraphView"), { ssr: false });
const MindmapView = dynamic(() => import("./views/MindmapView"), { ssr: false });
const BoardView = dynamic(() => import("./views/BoardView"), { ssr: false });
const CardsView = dynamic(() => import("./views/CardsView"), { ssr: false });
const TimelineView = dynamic(() => import("./views/TimelineView"), { ssr: false });

interface Props {
  projectId: string;
}

export function ViewRenderer({ projectId }: Props) {
  const params = useSearchParams();
  const view = (params.get("view") as ViewType | null) ?? "graph";
  const root = params.get("root") ?? undefined;

  switch (view) {
    case "mindmap":
      return <MindmapView projectId={projectId} root={root} />;
    case "board":
      return <BoardView projectId={projectId} root={root} />;
    case "cards":
      return <CardsView projectId={projectId} />;
    case "timeline":
      return <TimelineView projectId={projectId} />;
    case "graph":
    default:
      return <GraphView projectId={projectId} />;
  }
}
