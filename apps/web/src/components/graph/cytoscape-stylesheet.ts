import type { StylesheetStyle } from "cytoscape";

// Visual tokens chosen to fit the neutral monochrome OpenCairn palette
// (no warm/ember colors per brand rule). Edge thickness scales with weight.
export const GRAPH_STYLESHEET: StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": "#737373",
      label: "data(label)",
      "font-size": "11px",
      color: "#171717",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.9,
      "text-background-padding": "3px",
      "text-margin-y": -8,
      "text-halign": "center",
      "text-valign": "top",
      width: "mapData(degree, 0, 30, 14, 36)",
      height: "mapData(degree, 0, 30, 14, 36)",
      "border-width": 1,
      "border-color": "#e5e5e5",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-width": 3,
      "border-color": "#171717",
    },
  },
  {
    selector: "edge",
    style: {
      "line-color": "#d4d4d4",
      "curve-style": "bezier",
      width: "mapData(weight, 0, 5, 1, 4)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "#d4d4d4",
    },
  },
  {
    selector: 'edge[supportStatus = "supported"]',
    style: {
      "line-color": "#171717",
      "target-arrow-color": "#171717",
    },
  },
  {
    selector: 'edge[supportStatus = "weak"]',
    style: {
      "line-style": "dashed",
      "line-color": "#737373",
      "target-arrow-color": "#737373",
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
      "line-color": "#dc2626",
      "target-arrow-color": "#dc2626",
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
