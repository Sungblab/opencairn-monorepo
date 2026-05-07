import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";

describe("Command primitives", () => {
  beforeEach(() => {
    global.ResizeObserver = class ResizeObserver {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("uses roomy input and item sizing for the app command palette", () => {
    render(
      <Command>
        <CommandInput placeholder="Search" />
        <CommandList>
          <CommandGroup heading="Actions">
            <CommandItem value="dashboard">Dashboard</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>,
    );

    const inputGroup = screen
      .getByPlaceholderText("Search")
      .closest("[data-slot='input-group']");
    expect(inputGroup).toHaveClass(
      "h-11!",
      "rounded-[var(--radius-control)]!",
    );
    expect(screen.getByText("Dashboard")).toHaveClass(
      "min-h-10",
      "rounded-[var(--radius-control)]!",
      "px-3",
    );
  });

  it("uses a wider app-palette dialog surface", () => {
    render(
      <CommandDialog open onOpenChange={() => {}}>
        <Command />
      </CommandDialog>,
    );

    expect(screen.getByRole("dialog")).toHaveClass(
      "sm:max-w-[680px]",
      "max-w-[calc(100vw-32px)]",
      "rounded-[var(--radius-control)]",
    );
  });
});
