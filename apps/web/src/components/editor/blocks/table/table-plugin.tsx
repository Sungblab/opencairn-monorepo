"use client";
import {
  TablePlugin as BaseTablePlugin,
  TableRowPlugin,
  TableCellPlugin,
  TableCellHeaderPlugin,
} from "@platejs/table/react";
import type { AnyPlatePlugin } from "platejs/react";
import {
  TableCellElement,
  TableCellHeaderElement,
} from "./table-context-menu";

// Plan 2D — Table block. The official @platejs/table plugins handle node
// shape, row/col operations, and selection.
//
// Plan 2E Phase A — Cell renderers swapped to our `TableCellElement` /
// `TableCellHeaderElement` so a right-click on any cell opens the
// row/column/merge/split context menu. The default cell components from
// @platejs/table render a vanilla `<td>` / `<th>` with no UI affordances,
// so replacing them is lossless for the existing layout — we only add the
// menu trigger.
export const tablePlugins: AnyPlatePlugin[] = [
  BaseTablePlugin,
  TableRowPlugin,
  TableCellPlugin.withComponent(TableCellElement),
  TableCellHeaderPlugin.withComponent(TableCellHeaderElement),
];
