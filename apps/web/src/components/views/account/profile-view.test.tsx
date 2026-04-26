import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}));

const meGet = vi.fn();
const mePatch = vi.fn();
vi.mock("@/lib/api-client", () => ({
  meApi: {
    get: () => meGet(),
    patch: (b: { name?: string }) => mePatch(b),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ProfileView } from "./profile-view";

function renderWith(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <ProfileView />
    </QueryClientProvider>,
  );
}

describe("ProfileView hydration guard", () => {
  it("does not snap the input back to the server name when the user clears it", async () => {
    meGet.mockResolvedValue({
      id: "user-1",
      email: "ada@example.com",
      name: "Ada",
      image: null,
      plan: "free",
      locale: null,
      timezone: null,
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWith(qc);

    // Wait for hydration.
    const input = await screen.findByDisplayValue("Ada");

    // Clear the field — the buggy version re-set it to "Ada" because the
    // sync gate (`name === ""`) became true again on the next render.
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toHaveValue("");

    // Type a new value and confirm it sticks across re-renders triggered by
    // unrelated query state.
    fireEvent.change(input, { target: { value: "B" } });
    expect(input).toHaveValue("B");

    // Force a re-render by invalidating the cache — `data` reference is
    // unchanged so the hydration ref must keep us from snapping back.
    await qc.invalidateQueries({ queryKey: ["me"] });
    await waitFor(() => expect(input).toHaveValue("B"));
  });

  it("re-hydrates when the underlying user changes (logout/relogin)", async () => {
    meGet.mockResolvedValueOnce({
      id: "user-1",
      email: "a@x",
      name: "Ada",
      image: null,
      plan: "free",
      locale: null,
      timezone: null,
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    renderWith(qc);
    await screen.findByDisplayValue("Ada");

    meGet.mockResolvedValueOnce({
      id: "user-2",
      email: "b@x",
      name: "Babbage",
      image: null,
      plan: "free",
      locale: null,
      timezone: null,
    });
    await qc.invalidateQueries({ queryKey: ["me"] });
    await screen.findByDisplayValue("Babbage");
  });
});
