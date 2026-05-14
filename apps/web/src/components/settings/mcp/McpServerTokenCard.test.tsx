import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { McpServerTokenCard } from "./McpServerTokenCard";
import * as api from "@/lib/api/mcp-server-tokens";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/mcp-server-tokens");

const messages = {
  settings: {
    mcp: {
      server_tokens: {
        heading: "OpenCairn MCP access tokens",
        description: "Create read-only workspace tokens for external MCP clients.",
        workspace: "Workspace",
        workspaces_loading: "Loading workspaces...",
        workspaces_failed: "Could not load workspaces.",
        no_admin_workspace: "No admin workspace.",
        label: "Label",
        placeholder: "Claude Code",
        create: "Create token",
        creating: "Creating...",
        created: "Token created",
        create_failed: "Could not create token.",
        copy_once: "Copy this token now. It will not be shown again.",
        copy: "Copy",
        empty: "No tokens yet.",
        loading: "Loading tokens...",
        load_failed: "Could not load tokens.",
        revoke: "Revoke",
        revoked: "Token revoked.",
        revoked_label: "Revoked",
        revoke_failed: "Could not revoke token.",
      },
    },
  },
};

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={qc}>
        <McpServerTokenCard workspaceId="11111111-1111-4111-8111-111111111111" />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

describe("McpServerTokenCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.mcpServerTokensQueryKey).mockImplementation((workspaceId) => [
      "mcp-server-tokens",
      workspaceId,
    ]);
  });

  it("creates a token and displays plaintext once", async () => {
    vi.mocked(api.listMcpServerTokens).mockResolvedValue({ tokens: [] });
    vi.mocked(api.createMcpServerToken).mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      workspaceId: "11111111-1111-4111-8111-111111111111",
      label: "Claude Code",
      token: "ocmcp_" + "a".repeat(43),
      tokenPrefix: "ocmcp_aaaa",
      scopes: ["workspace:read"],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: "2026-04-30T00:00:00.000Z",
    });
    renderCard();
    await userEvent.type(await screen.findByLabelText("Label"), "Claude Code");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText(/ocmcp_/)).toBeInTheDocument();
    expect(screen.getByText("Copy this token now. It will not be shown again.")).toBeInTheDocument();
  });

  it("revokes an existing token", async () => {
    vi.mocked(api.listMcpServerTokens).mockResolvedValue({
      tokens: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          workspaceId: "11111111-1111-4111-8111-111111111111",
          label: "Claude Code",
          tokenPrefix: "ocmcp_aaaa",
          scopes: ["workspace:read"],
          expiresAt: null,
          lastUsedAt: null,
          revokedAt: null,
          createdAt: "2026-04-30T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(api.revokeMcpServerToken).mockResolvedValue(undefined);
    renderCard();
    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(api.revokeMcpServerToken).toHaveBeenCalledWith(
        "22222222-2222-4222-8222-222222222222",
        expect.anything(),
      ),
    );
  });
});
