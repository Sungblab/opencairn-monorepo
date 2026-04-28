import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { McpServerList } from "./McpServerList";

const messages = {
  settings: {
    mcp: {
      list: {
        empty: "No servers",
        tool_count: "{count} tools",
        test_button: "Test",
        edit_button: "Edit",
        delete_button: "Delete",
      },
      status: {
        active: "Active",
        disabled: "Disabled",
        auth_expired: "Auth expired",
      },
    },
  },
};

const server = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  serverSlug: "smoke_echo",
  displayName: "Smoke Echo",
  serverUrl: "https://echo.example/mcp",
  authHeaderName: "Authorization",
  hasAuth: false,
  status: "active" as const,
  lastSeenToolCount: 2,
  lastSeenAt: null,
  createdAt: "2026-04-28T00:00:00.000Z",
  updatedAt: "2026-04-28T00:00:00.000Z",
};

function renderList(overrides = {}) {
  const props = {
    servers: [server],
    onTest: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <McpServerList {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

describe("McpServerList", () => {
  it("renders server details and tool count", () => {
    renderList();
    expect(screen.getByText("Smoke Echo")).toBeInTheDocument();
    expect(screen.getByText("2 tools")).toBeInTheDocument();
  });

  it("invokes test action with server id", () => {
    const props = renderList();
    fireEvent.click(screen.getByRole("button", { name: "Test" }));
    expect(props.onTest).toHaveBeenCalledWith(server.id);
  });

  it("renders auth expired status", () => {
    renderList({ servers: [{ ...server, status: "auth_expired" as const }] });
    expect(screen.getByText("Auth expired")).toBeInTheDocument();
  });
});
