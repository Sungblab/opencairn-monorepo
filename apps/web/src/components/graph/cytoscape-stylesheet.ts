import type { StylesheetStyle } from "cytoscape";

// Visual tokens chosen to fit the neutral monochrome OpenCairn palette
// (no warm/ember colors per brand rule). Edge thickness scales with weight.
export const GRAPH_STYLESHEET: StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": "hsl(var(--foreground) / 0.85)",
      label: "data(label)",
      "font-size": "11px",
      color: "hsl(var(--foreground))",
      "text-margin-y": -8,
      "text-halign": "center",
      "text-valign": "top",
      width: "mapData(degree, 0, 30, 14, 36)",
      height: "mapData(degree, 0, 30, 14, 36)",
      "border-width": 1,
      "border-color": "hsl(var(--border))",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-width": 3,
      "border-color": "hsl(var(--primary))",
    },
  },
  {
    selector: "edge",
    style: {
      "line-color": "hsl(var(--border))",
      "curve-style": "bezier",
      width: "mapData(weight, 0, 5, 1, 4)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "hsl(var(--border))",
    },
  },
  {
    selector: 'edge[supportStatus = "supported"]',
    style: {
      "line-color": "hsl(var(--primary))",
      "target-arrow-color": "hsl(var(--primary))",
    },
  },
  {
    selector: 'edge[supportStatus = "weak"]',
    style: {
      "line-style": "dashed",
      "line-color": "hsl(var(--muted-foreground))",
      "target-arrow-color": "hsl(var(--muted-foreground))",
    },
  },
  {
    selector: 'edge[supportStatus = "stale"]',
    style: {
      "line-style": "dotted",
      "line-color": "#7c6f64",
      "target-arrow-color": "#7c6f64",
    },
  },
  {
    selector: 'edge[supportStatus = "disputed"]',
    style: {
      "line-style": "dashed",
      "line-color": "hsl(var(--destructive))",
      "target-arrow-color": "hsl(var(--destructive))",
    },
  },
  {
    selector: 'edge[supportStatus = "missing"]',
    style: {
      opacity: 0.55,
      "line-style": "dotted",
    },
  },
  {
    selector: "edge:selected",
    style: {
      width: 5,
      "z-index": 10,
    },
  },
];
