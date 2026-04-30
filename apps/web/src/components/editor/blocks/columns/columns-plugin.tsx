"use client";
import { ColumnPlugin, ColumnItemPlugin } from "@platejs/layout/react";
import { ColumnGroupElement } from "./column-group-element";

// Plan 2D — Columns layout block. @platejs/layout already provides the
// element types and transforms; we expose them as a single registration
// array, mirroring the table-plugin pattern.
//
// NOTE: The actual @platejs/layout@49 exports differ from the spec:
//   ColumnPlugin     — the column GROUP container (node key: "column_group")
//   ColumnItemPlugin — the individual column item   (node key: "column")
// There is no "ColumnGroupPlugin" in this version.
//
// Plan 2E Phase B-3 — ColumnPlugin is extended with a custom renderer
// (ColumnGroupElement) that displays resize handles between columns and
// persists the widths[] array to the Slate/Yjs document on pointerup.
export const columnsPlugins = [
  ColumnPlugin.withComponent(ColumnGroupElement),
  ColumnItemPlugin,
];
