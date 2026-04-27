import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PinButton } from "./PinButton";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (k: string, vars?: Record<string, unknown>) =>
    vars
      ? `${ns ? `${ns}.` : ""}${k}(${JSON.stringify(vars)})`
      : ns
        ? `${ns}.${k}`
        : k,
}));

const fetchMock = vi.fn();
beforeEach(() => {
  (globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  fetchMock.mockReset();
});

describe("<PinButton>", () => {
  it("flips to Pinned state on a 200 response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ pinned: true }),
    });
    render(
      <PinButton messageId="m1" targetNoteId="n1" targetBlockId="b1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pin\.button/ }));
    await waitFor(() =>
      expect(screen.getByText(/pin\.pinned/)).toBeInTheDocument(),
    );
  });

  it("opens the confirmation modal on a 409 response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        requireConfirm: true,
        warning: {
          hiddenSources: [
            { sourceType: "note", sourceId: "x", snippet: "..." },
          ],
          hiddenUsers: [{ userId: "u2", reason: "no_access_to_cited_source" }],
        },
      }),
    });
    render(
      <PinButton messageId="m1" targetNoteId="n1" targetBlockId="b1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pin\.button/ }));
    await waitFor(() =>
      expect(screen.getByText(/modal_title/)).toBeInTheDocument(),
    );
  });

  it("calls /pin/confirm when the user confirms in the modal", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          requireConfirm: true,
          warning: {
            hiddenSources: [
              { sourceType: "note", sourceId: "x", snippet: "..." },
            ],
            hiddenUsers: [{ userId: "u2", reason: "x" }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ pinned: true }),
      });
    render(
      <PinButton messageId="m1" targetNoteId="n1" targetBlockId="b1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /pin\.button/ }));
    await waitFor(() => screen.getByText(/modal_title/));
    fireEvent.click(screen.getByText(/^chatScope\.pin\.confirm$/));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/chat/messages/m1/pin/confirm",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
