import type { ViewNode } from "@opencairn/shared";

const NODE_RADIUS = 8;
const NODE_PADDING_X = 80;
const HEIGHT = 200;
const MIN_WIDTH = 800;

export interface PositionedNode {
  id: string;
  name: string;
  description?: string;
  x: number;
  y: number;
  firstNoteId?: string | null;
}

export interface TimelineTick {
  x: number;
  label: string;
}

export interface TimelineLayout {
  nodes: PositionedNode[];
  ticks: TimelineTick[];
  width: number;
  height: number;
}

/**
 * Pick the year to use for axis placement: prefer the curated `eventYear`
 * (set by Compiler when the concept is intrinsically time-anchored — e.g.
 * "Transformer (2017)"), fall back to the note's `createdAt` if the server
 * surfaced it. Returns `null` for nodes without either signal so the caller
 * can park them at the timeline midpoint.
 */
function nodeYear(n: ViewNode): number | null {
  if (typeof n.eventYear === "number") return n.eventYear;
  const created = (n as ViewNode & { createdAt?: string }).createdAt;
  if (typeof created === "string") {
    const yr = new Date(created).getFullYear();
    if (Number.isFinite(yr)) return yr;
  }
  return null;
}

/**
 * Pure layout helper for `?view=timeline`. Maps an unordered list of concepts
 * to an x/y coordinate set anchored on a left-to-right year axis. Tested in
 * isolation (no React, no DOM) so axis math regressions surface immediately.
 */
export function layoutTimeline(input: ViewNode[]): TimelineLayout {
  if (input.length === 0) {
    return { nodes: [], ticks: [], width: MIN_WIDTH, height: HEIGHT };
  }
  const sorted = [...input].sort((a, b) => {
    const ya = nodeYear(a) ?? 0;
    const yb = nodeYear(b) ?? 0;
    return ya - yb;
  });
  const years = sorted
    .map((n) => nodeYear(n))
    .filter((y): y is number => y !== null);
  const minYear = years[0] ?? 0;
  const maxYear = years[years.length - 1] ?? minYear;
  const span = Math.max(1, maxYear - minYear);
  const width = Math.max(MIN_WIDTH, sorted.length * NODE_PADDING_X);

  const positionedNodes: PositionedNode[] = sorted.map((n) => {
    const y = nodeYear(n);
    const ratio = y === null ? 0.5 : (y - minYear) / span;
    return {
      id: n.id,
      name: n.name,
      description: n.description,
      firstNoteId: n.firstNoteId ?? null,
      x: NODE_PADDING_X / 2 + ratio * (width - NODE_PADDING_X),
      y: HEIGHT / 2,
    };
  });

  // 2..8 ticks depending on span — short spans (<20 years) get one tick per
  // year; longer spans cap at 8 to avoid label collisions.
  const tickCount = Math.min(8, Math.max(2, span < 20 ? span + 1 : 8));
  const ticks: TimelineTick[] = Array.from({ length: tickCount }, (_, i) => {
    const ratio = tickCount === 1 ? 0 : i / (tickCount - 1);
    const year = Math.round(minYear + ratio * span);
    return {
      x: NODE_PADDING_X / 2 + ratio * (width - NODE_PADDING_X),
      label: String(year),
    };
  });

  return { nodes: positionedNodes, ticks, width, height: HEIGHT };
}

export const TIMELINE_NODE_RADIUS = NODE_RADIUS;
