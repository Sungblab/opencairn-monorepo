import type { ViewNode } from "@opencairn/shared";

const NODE_RADIUS = 8;
const NODE_PADDING_X = 120;
const MIN_WIDTH = 860;
const LANE_TOP = 74;
const LANE_GAP = 118;
const DENSE_ROW_GAP = 30;
const BOTTOM_PADDING = 72;

export type TimelineLaneId = "event" | "created" | "undated";

export interface TimelineLane {
  id: TimelineLaneId;
  y: number;
}

export interface PositionedNode {
  id: string;
  name: string;
  description?: string;
  x: number;
  y: number;
  firstNoteId?: string | null;
  year: number | null;
  lane: TimelineLaneId;
}

export interface TimelineTick {
  x: number;
  label: string;
}

export interface TimelineLayout {
  nodes: PositionedNode[];
  lanes: TimelineLane[];
  ticks: TimelineTick[];
  width: number;
  height: number;
  omittedCount: number;
}

function nodeYearAndLane(n: ViewNode): { year: number | null; lane: TimelineLaneId } {
  if (typeof n.eventYear === "number") {
    return { year: n.eventYear, lane: "event" };
  }
  const created = (n as ViewNode & { createdAt?: string }).createdAt;
  if (typeof created === "string") {
    const yr = new Date(created).getFullYear();
    if (Number.isFinite(yr)) return { year: yr, lane: "created" };
  }
  return { year: null, lane: "undated" };
}

function laneY(lane: TimelineLaneId): number {
  if (lane === "event") return LANE_TOP;
  if (lane === "created") return LANE_TOP + LANE_GAP;
  return LANE_TOP + LANE_GAP * 2;
}

/**
 * Pure layout helper for `?view=timeline`. Dated concepts sit on semantic
 * lanes; undated concepts stay visible in their own lane instead of vanishing.
 */
export function layoutTimeline(input: ViewNode[]): TimelineLayout {
  const lanes: TimelineLane[] = [
    { id: "event", y: laneY("event") },
    { id: "created", y: laneY("created") },
    { id: "undated", y: laneY("undated") },
  ];
  if (input.length === 0) {
    return {
      nodes: [],
      lanes,
      ticks: [],
      width: MIN_WIDTH,
      height: laneY("undated") + BOTTOM_PADDING,
      omittedCount: 0,
    };
  }

  const entries = input
    .map((node) => ({ node, ...nodeYearAndLane(node) }))
    .sort((a, b) => {
      if (a.year !== null && b.year !== null && a.year !== b.year) {
        return a.year - b.year;
      }
      if (a.lane !== b.lane) return a.lane.localeCompare(b.lane);
      return a.node.name.localeCompare(b.node.name);
    });
  const dated = entries.filter((entry) => entry.year !== null);
  const years = dated.map((entry) => entry.year as number);
  const minYear = years[0] ?? new Date().getFullYear();
  const maxYear = years[years.length - 1] ?? minYear;
  const sameYear = minYear === maxYear;
  const span = Math.max(1, maxYear - minYear);
  const width = Math.max(MIN_WIDTH, input.length * NODE_PADDING_X);
  const indexByLane = new Map<TimelineLaneId, number>();
  const totalByLane = new Map<TimelineLaneId, number>();
  const indexByLaneYear = new Map<string, number>();
  const totalByLaneYear = new Map<string, number>();
  for (const entry of entries) {
    totalByLane.set(entry.lane, (totalByLane.get(entry.lane) ?? 0) + 1);
    if (entry.year !== null) {
      const key = `${entry.lane}:${entry.year}`;
      totalByLaneYear.set(key, (totalByLaneYear.get(key) ?? 0) + 1);
    }
  }

  const positionedNodes: PositionedNode[] = entries.map(({ node, year, lane }, index) => {
    const laneIndex = indexByLane.get(lane) ?? 0;
    indexByLane.set(lane, laneIndex + 1);
    const laneTotal = totalByLane.get(lane) ?? 1;
    const rowCount = laneTotal > 8 ? 5 : laneTotal > 3 ? 3 : 1;
    const rowIndex = rowCount === 1 ? 0 : laneIndex % rowCount;
    const rowOffset = (rowIndex - (rowCount - 1) / 2) * DENSE_ROW_GAP;
    const ratio =
      year === null
        ? (laneIndex + 0.5) / laneTotal
        : sameYear
          ? index / Math.max(1, dated.length - 1)
          : (year - minYear) / span;
    const duplicateYearOffset = (() => {
      if (year === null || sameYear) return 0;
      const key = `${lane}:${year}`;
      const total = totalByLaneYear.get(key) ?? 1;
      if (total <= 1) return 0;
      const used = indexByLaneYear.get(key) ?? 0;
      indexByLaneYear.set(key, used + 1);
      return (used - (total - 1) / 2) * 42;
    })();
    const baseX = NODE_PADDING_X / 2 + ratio * (width - NODE_PADDING_X);
    return {
      id: node.id,
      name: node.name,
      description: node.description,
      firstNoteId: node.firstNoteId ?? null,
      x: Math.max(
        NODE_PADDING_X / 2,
        Math.min(width - NODE_PADDING_X / 2, baseX + duplicateYearOffset),
      ),
      y: laneY(lane) + rowOffset,
      year,
      lane,
    };
  });

  const tickCount =
    dated.length === 0
      ? 0
      : sameYear
        ? 1
        : Math.min(8, Math.max(2, span < 20 ? span + 1 : 8));
  const ticks: TimelineTick[] = Array.from({ length: tickCount }, (_, i) => {
    const ratio = tickCount === 1 ? 0 : i / (tickCount - 1);
    const year = Math.round(minYear + ratio * span);
    return {
      x: NODE_PADDING_X / 2 + ratio * (width - NODE_PADDING_X),
      label: String(year),
    };
  });

  return {
    nodes: positionedNodes,
    lanes,
    ticks,
    width,
    height: laneY("undated") + BOTTOM_PADDING,
    omittedCount: 0,
  };
}

export const TIMELINE_NODE_RADIUS = NODE_RADIUS;
