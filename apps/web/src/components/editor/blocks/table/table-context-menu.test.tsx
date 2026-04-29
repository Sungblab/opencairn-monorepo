import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import koMessages from "@/../messages/ko/editor.json";
import { TableCellElement } from "./table-context-menu";

// Plate editor mock — captures every tf call so each test can assert
// "right-click → click menu item → correct transform fired with the right
// path". `findPath` returns a fixed cell path so menu options that close
// over `at: path` produce a stable assertion target.
const findPath = vi.fn(() => [0, 1, 0]);
const insertRow = vi.fn();
const insertCol = vi.fn();
const removeTable = vi.fn();
const removeRow = vi.fn();
const removeCol = vi.fn();
const tableMerge = vi.fn();
const tableSplit = vi.fn();

vi.mock("platejs/react", async () => {
  const actual = await vi.importActual<typeof import("platejs/react")>(
    "platejs/react",
  );
  return {
    ...actual,
    useEditorRef: () => ({
      api: { findPath },
      tf: {
        insert: { tableRow: insertRow, tableColumn: insertCol },
        remove: { table: removeTable, tableRow: removeRow, tableColumn: removeCol },
        table: { merge: tableMerge, split: tableSplit },
      },
    }),
  };
});

const wrap = (ui: React.ReactNode) => (
  <NextIntlClientProvider locale="ko" messages={{ editor: koMessages }}>
    {/* A minimal table tree wraps the cell so the rendered <td> isn't an
        invalid HTML descendant of <body>. The cell is what we test. */}
    <table>
      <tbody>
        <tr>{ui}</tr>
      </tbody>
    </table>
  </NextIntlClientProvider>
);

const renderCell = () =>
  render(
    wrap(
      // @ts-expect-error — Plate's full editor context isn't needed here.
      <TableCellElement
        attributes={{ "data-slate-node": "element", ref: null } as never}
        element={{ type: "table_cell", children: [{ text: "" }] }}
      >
        <span data-testid="cell-content">cell</span>
      </TableCellElement>,
    ),
  );

const openMenu = () => {
  const trigger = screen.getByTestId("table-cell-context-trigger");
  // Base UI's ContextMenuTrigger opens on the native `contextmenu` event;
  // jsdom dispatches it through fireEvent, and the popup mounts inside
  // the Portal synchronously.
  fireEvent.contextMenu(trigger);
};

describe("TableCellElement context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders cell children inside a <td>", () => {
    renderCell();
    const trigger = screen.getByTestId("table-cell-context-trigger");
    expect(trigger.tagName).toBe("TD");
    expect(screen.getByTestId("cell-content")).toBeInTheDocument();
  });

  it("inserts a row below when 'row below' is clicked", () => {
    renderCell();
    openMenu();
    fireEvent.click(screen.getByTestId("table-menu-row-below"));
    expect(insertRow).toHaveBeenCalledWith({
      at: [0, 1, 0],
      before: false,
      select: true,
    });
  });

  it("inserts a row above when 'row above' is clicked", () => {
    renderCell();
    openMenu();
    fireEvent.click(screen.getByTestId("table-menu-row-above"));
    expect(insertRow).toHaveBeenCalledWith({
      at: [0, 1, 0],
      before: true,
      select: true,
    });
  });

  it("inserts a column right when 'col right' is clicked", () => {
    renderCell();
    openMenu();
    fireEvent.click(screen.getByTestId("table-menu-col-right"));
    expect(insertCol).toHaveBeenCalledWith({
      at: [0, 1, 0],
      before: false,
      select: true,
    });
  });

  it("deletes the table when 'table delete' is clicked", () => {
    renderCell();
    openMenu();
    fireEvent.click(screen.getByTestId("table-menu-table-delete"));
    expect(removeTable).toHaveBeenCalledTimes(1);
  });

  it("merges cells when 'merge' is clicked", () => {
    renderCell();
    openMenu();
    fireEvent.click(screen.getByTestId("table-menu-merge"));
    expect(tableMerge).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain <td> when path is unresolved", () => {
    findPath.mockReturnValueOnce(undefined as unknown as number[]);
    renderCell();
    expect(screen.queryByTestId("table-cell-context-trigger")).toBeNull();
    expect(screen.getByTestId("cell-content")).toBeInTheDocument();
  });
});
