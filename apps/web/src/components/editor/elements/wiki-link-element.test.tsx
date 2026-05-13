import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api-client";
import {
  WikiLinkElement,
  type WikiLinkElement as WikiLinkElementType,
} from "./wiki-link-element";

vi.mock("@/lib/api-client", () => ({
  api: {
    getNote: vi.fn(async () => ({ id: "note-1", title: "New title" })),
  },
}));

const WikiLinkElementForTest =
  WikiLinkElement as unknown as React.ComponentType<{
    attributes: Record<string, unknown>;
    element: WikiLinkElementType;
    children: React.ReactNode;
    wsSlug: string;
    projectId: string;
  }>;

function renderWikiLink() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="ko"
        messages={{ editor: { wikilink: { deleted: "삭제된 노트" } } }}
      >
        <WikiLinkElementForTest
          attributes={{}}
          element={{
            type: "wiki-link",
            targetId: "note-1",
            title: "Old title",
            children: [{ text: "" }],
          }}
          wsSlug="acme"
          projectId="project-1"
        >
          {null}
        </WikiLinkElementForTest>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("WikiLinkElement", () => {
  it("renders the current target note title when the stored label is stale", async () => {
    renderWikiLink();

    expect(await screen.findByRole("link", { name: "New title" })).toHaveAttribute(
      "data-stale-title",
      "true",
    );
    expect(api.getNote).toHaveBeenCalledWith("note-1");
  });
});
