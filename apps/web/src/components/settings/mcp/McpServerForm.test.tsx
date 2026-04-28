import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { McpServerForm } from "./McpServerForm";

const messages = {
  settings: {
    mcp: {
      form: {
        display_name: "Display name",
        server_url: "Server URL",
        auth_header_name: "Header name",
        auth_header_value: "Header value",
        save: "Save",
        cancel: "Cancel",
      },
    },
  },
};

function renderForm(onSubmit = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <McpServerForm mode="create" onSubmit={onSubmit} onCancel={vi.fn()} />
    </NextIntlClientProvider>,
  );
  return onSubmit;
}

describe("McpServerForm", () => {
  it("submits a create payload", async () => {
    const onSubmit = renderForm();
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Smoke Echo" },
    });
    fireEvent.change(screen.getByLabelText("Server URL"), {
      target: { value: "https://echo.example/mcp" },
    });
    fireEvent.change(screen.getByLabelText("Header value"), {
      target: { value: "Bearer secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        displayName: "Smoke Echo",
        serverUrl: "https://echo.example/mcp",
        authHeaderName: "Authorization",
        authHeaderValue: "Bearer secret",
      }),
    );
  });
});
