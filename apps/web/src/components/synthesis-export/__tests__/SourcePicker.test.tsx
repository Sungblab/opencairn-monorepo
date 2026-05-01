import type React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SourcePicker } from "../SourcePicker";
import type { PickedSource } from "../SourcePicker";
import messages from "../../../../messages/ko/synthesis-export.json";

const defaultSources: PickedSource[] = [
  { id: "s1", title: "노트 A", kind: "note" },
  { id: "s2", title: "노트 B", kind: "note" },
];

function setup(overrides: Partial<Parameters<typeof SourcePicker>[0]> = {}) {
  const onAddSource = vi.fn();
  const onRemoveSource = vi.fn();
  const onAutoSearchChange = vi.fn();
  return {
    onAddSource,
    onRemoveSource,
    onAutoSearchChange,
    ...render(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider
          locale="ko"
          messages={{ synthesisExport: messages }}
        >
          <SourcePicker
            workspaceId="ws-1"
            sources={defaultSources}
            autoSearch={false}
            onAddSource={onAddSource}
            onRemoveSource={onRemoveSource}
            onAutoSearchChange={onAutoSearchChange}
            {...overrides}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("SourcePicker", () => {
  it("emits removeSource('s1') on remove click", () => {
    const { onRemoveSource } = setup();
    const removeButtons = screen.getAllByLabelText(/제거|remove/i);
    fireEvent.click(removeButtons[0]);
    expect(onRemoveSource).toHaveBeenCalledWith("s1");
  });

  it("toggles autoSearch checkbox", () => {
    const { onAutoSearchChange } = setup({ autoSearch: false });
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onAutoSearchChange).toHaveBeenCalledWith(true);
  });

  it("renders the note search input", () => {
    setup();
    expect(screen.getByPlaceholderText("노트 제목으로 검색")).toBeInTheDocument();
  });
});
