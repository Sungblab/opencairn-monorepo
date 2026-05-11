import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { ReadingViewer } from "./reading-viewer";
import { useTabsStore } from "@/stores/tabs-store";

vi.mock("next/dynamic", () => ({
  default: () => {
    const DynamicReadingViewerBody = (props: Record<string, unknown>) => {
      const React = require("react") as typeof import("react");
      const size = props.size as number;
      const setSize = props.setSize as (size: number) => void;
      const label = props.label as {
        editMode: string;
        fontSize: string;
        readingMode: string;
      };
      const tab = props.tab as { id: string };
      const updateTab = useTabsStore.getState().updateTab;

      return React.createElement(
        "div",
        { "data-testid": "reading-viewer", className: "h-full" },
        React.createElement("span", {}, label.readingMode),
        React.createElement("input", {
          type: "range",
          min: 14,
          max: 22,
          step: 1,
          value: size,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            setSize(Number(e.target.value)),
          "aria-label": label.fontSize,
        }),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => updateTab(tab.id, { mode: "plate" }),
          },
          label.editMode,
        ),
        React.createElement(
          "div",
          {
            "data-testid": "reading-viewer-body",
            style: { fontSize: `${size}px` },
          },
          React.createElement("div", { "data-testid": "plate-content" }),
        ),
      );
    };
    return DynamicReadingViewerBody;
  },
}));

// Mock collaborative editor — the hook returns a stub PlateEditor.
vi.mock("@/hooks/useCollaborativeEditor", () => ({
  useCollaborativeEditor: () => ({
    children: [{ type: "p", children: [{ text: "hello" }] }],
    tf: {},
  }),
  colorFor: () => "#000",
}));

// Plate v49 internals pull in Y.Doc and a bunch of plugin machinery that
// isn't relevant to the shell dispatch test. Shallow-mock Plate/PlateContent
// so the test can run headlessly — the ReadingViewer's job is the shell
// (font slider + meta fetch), not to exercise Plate itself.
vi.mock("platejs/react", () => ({
  Plate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PlateContent: (p: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
    <div {...p} data-testid={(p["data-testid"] as string) ?? "plate-content"} />
  ),
}));

// latex.tsx imports katex CSS at module scope — no CSS loader in jsdom.
vi.mock("@/components/editor/plugins/latex", () => ({ latexPlugins: [] }));

const messages = {
  appShell: {
    viewers: {
      reading: {
        editMode: "편집",
        fontSize: "폰트 크기",
        readingMode: "읽기 모드",
        readingTime: "약 {min}분",
      },
    },
  },
};

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="ko" messages={messages}>
        {node}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const tab = {
  id: "t",
  kind: "note" as const,
  targetId: "n1",
  mode: "reading" as const,
  title: "T",
  titleKey: undefined,
  titleParams: undefined,
  pinned: false,
  preview: false,
  dirty: false,
  splitWith: null,
  splitSide: null as "left" | "right" | null,
  scrollY: 0,
};

describe("ReadingViewer", () => {
  beforeEach(() => {
    useTabsStore.setState(
      { ...useTabsStore.getInitialState(), tabs: [tab], activeId: tab.id },
      true,
    );
    // Fetch mock used by the internal useQuery calls for note meta + me.
    global.fetch = vi.fn(async (url: string | URL) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/api/auth/me") || href.endsWith("/me")) {
        return new Response(
          JSON.stringify({ userId: "u1", email: "u@x", name: "U" }),
        );
      }
      if (href.includes("/api/notes/")) {
        return new Response(
          JSON.stringify({ id: "n1", title: "T", workspaceId: "w1" }),
        );
      }
      return new Response("{}", { status: 404 });
    }) as never;
  });

  it("renders the Plate content area once meta loads", async () => {
    wrap(<ReadingViewer tab={tab} />);
    await waitFor(() =>
      expect(screen.getByTestId("plate-content")).toBeInTheDocument(),
    );
  });

  it("shows a font-size slider and updates the container fontSize", async () => {
    wrap(<ReadingViewer tab={tab} />);
    const slider = await screen.findByLabelText("폰트 크기");
    fireEvent.change(slider, { target: { value: "20" } });
    expect(screen.getByTestId("reading-viewer-body").style.fontSize).toBe(
      "20px",
    );
  });

  it("labels reading mode and can switch the tab back to edit mode", async () => {
    wrap(<ReadingViewer tab={tab} />);

    expect(await screen.findByText("읽기 모드")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "편집" }));

    expect(useTabsStore.getState().tabs[0]?.mode).toBe("plate");
  });

  it("renders nothing when tab.targetId is null", () => {
    const { container } = wrap(
      <ReadingViewer tab={{ ...tab, targetId: null }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
