import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScopedSearch } from "./scoped-search";
import { usePaletteStore } from "@/stores/palette-store";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    ns ? `${ns}.${key}` : key,
}));

describe("ScopedSearch", () => {
  beforeEach(() => {
    usePaletteStore.setState({ isOpen: false, query: "" });
  });

  it("clicking the trigger flips the palette store to open", () => {
    render(<ScopedSearch />);
    fireEvent.click(screen.getByRole("button"));
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });
});
