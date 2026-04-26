"use client";
import {
  TablePlugin as BaseTablePlugin,
  TableRowPlugin,
  TableCellPlugin,
  TableCellHeaderPlugin,
} from "@platejs/table/react";

// Plan 2D — Table block. The official @platejs/table plugins handle node
// shape, row/col operations, and selection. We register them as-is for
// now; row/col context menus + header toggle land in a follow-up task.
export const tablePlugins = [
  BaseTablePlugin,
  TableRowPlugin,
  TableCellPlugin,
  TableCellHeaderPlugin,
];
