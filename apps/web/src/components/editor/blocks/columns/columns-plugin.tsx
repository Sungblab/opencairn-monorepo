"use client";
import { ColumnPlugin, ColumnItemPlugin } from "@platejs/layout/react";

// Plan 2D — Columns layout block. @platejs/layout already provides the
// element types and transforms; we expose them as a single registration
// array, mirroring the table-plugin pattern.
//
// NOTE: The actual @platejs/layout@49 exports differ from the spec:
//   ColumnPlugin     — the column GROUP container (node key: "column_group")
//   ColumnItemPlugin — the individual column item   (node key: "column")
// There is no "ColumnGroupPlugin" in this version.
//
// Insert via the slash menu (Task 14) which calls
//   editor.tf.insertNodes({
//     type: 'column_group',
//     children: [<column_item>, <column_item>],
//   })
export const columnsPlugins = [ColumnPlugin, ColumnItemPlugin];
