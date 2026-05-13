"use client";
import { useTranslations } from "next-intl";
import { useEditorRef } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

// Plan 2E Phase A — Table cell renderer with row/column right-click menu.
// Replaces the default `@platejs/table` cell component via `.withComponent`.
//
// Why an entire cell renderer (vs. wrapping children only): the ContextMenu
// trigger needs to capture right-clicks across the full cell area including
// padding, otherwise users right-clicking near cell edges see the browser
// menu instead. Rendering the trigger as the `<td>` itself via Base UI's
// `render` prop preserves the table layout.
//
// `cellPath` is the absolute Slate path of this cell at the time of render.
// All transforms (`editor.tf.insert.tableRow({ at: cellPath, ... })`) operate
// on that path, so a stale path won't fire — re-renders happen on every
// editor mutation, keeping `path` fresh.
//
// Header cells (`type === "table_cell_header"`) reuse the same wrapper but
// render as `<th>`. The menu is identical because @platejs/table's
// transforms don't distinguish header vs. body for row/column ops.

export interface TableCellElementProps extends PlateElementProps {
  /** True when this cell is a header (`<th>`). */
  isHeader?: boolean;
}

export function TableElement({
  attributes,
  children,
}: PlateElementProps) {
  return (
    <table
      {...attributes}
      className="my-4 w-full border-collapse text-left text-sm"
    >
      <tbody>{children}</tbody>
    </table>
  );
}

export function TableRowElement({
  attributes,
  children,
}: PlateElementProps) {
  return (
    <tr {...attributes} className="border-b border-border last:border-b-0">
      {children}
    </tr>
  );
}

export function TableCellElement({
  attributes,
  children,
  element,
  isHeader = false,
}: TableCellElementProps) {
  const t = useTranslations("editor.table.menu");
  const editor = useEditorRef();
  const path = editor.api.findPath(element as never);

  // `path` may be undefined briefly on the first render before Slate has
  // finished normalizing the tree. Defer to a plain cell in that frame so
  // the layout doesn't flicker — context menu works on the next render.
  if (!path) {
    return isHeader ? (
      <th {...attributes} className="border border-border bg-muted/40 px-3 py-2">
        {children}
      </th>
    ) : (
      <td {...attributes} className="border border-border px-3 py-2 align-top">
        {children}
      </td>
    );
  }

  const tf = editor.tf as unknown as {
    insert: {
      tableRow: (opts: { at?: number[]; before?: boolean; select?: boolean }) => void;
      tableColumn: (opts: { at?: number[]; before?: boolean; select?: boolean }) => void;
    };
    remove: {
      table: () => void;
      tableRow: () => void;
      tableColumn: () => void;
    };
    table: { merge: () => void; split: () => void };
  };

  const Tag = isHeader ? "th" : "td";

  return (
    <ContextMenu>
      <ContextMenuTrigger
        data-testid="table-cell-context-trigger"
        // Render the trigger AS the table cell so right-click works across
        // the full cell area without breaking <table><tr><td> structure.
        render={
          <Tag
            {...attributes}
            className={
              isHeader
                ? "border border-border bg-muted/40 px-3 py-2"
                : "border border-border px-3 py-2 align-top"
            }
          >
            {children}
          </Tag>
        }
      />
      <ContextMenuContent>
        <ContextMenuItem
          data-testid="table-menu-row-above"
          onClick={() =>
            tf.insert.tableRow({ at: path, before: true, select: true })
          }
        >
          {t("row_above")}
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="table-menu-row-below"
          onClick={() =>
            tf.insert.tableRow({ at: path, before: false, select: true })
          }
        >
          {t("row_below")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-testid="table-menu-col-left"
          onClick={() =>
            tf.insert.tableColumn({ at: path, before: true, select: true })
          }
        >
          {t("col_left")}
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="table-menu-col-right"
          onClick={() =>
            tf.insert.tableColumn({ at: path, before: false, select: true })
          }
        >
          {t("col_right")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          data-testid="table-menu-merge"
          onClick={() => tf.table.merge()}
        >
          {t("merge")}
        </ContextMenuItem>
        <ContextMenuItem
          data-testid="table-menu-split"
          onClick={() => tf.table.split()}
        >
          {t("split")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          data-testid="table-menu-row-delete"
          onClick={() => tf.remove.tableRow()}
        >
          {t("row_delete")}
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          data-testid="table-menu-col-delete"
          onClick={() => tf.remove.tableColumn()}
        >
          {t("col_delete")}
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          data-testid="table-menu-table-delete"
          onClick={() => tf.remove.table()}
        >
          {t("table_delete")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TableCellHeaderElement(props: PlateElementProps) {
  return <TableCellElement {...props} isHeader />;
}
