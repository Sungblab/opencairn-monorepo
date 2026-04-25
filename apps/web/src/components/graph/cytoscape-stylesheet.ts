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
];
