import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminUsersClient } from "./AdminUsersClient";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const ok = (body: unknown) =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);

describe("AdminUsersClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/overview")) {
        return ok({
          stats: {},
          analytics: {
            userPlans: [],
            workspacePlans: [],
            actionStatuses: [],
            usageByAction: [],
          },
          recentReports: [],
          recentOperations: [],
          system: {
            environment: "test",
            internalApiUrl: null,
            publicAppUrl: null,
            email: { resendConfigured: false, smtpConfigured: false },
            storage: { s3Configured: false },
            featureFlags: {},
          },
        });
      }
      if (url.endsWith("/users")) return ok({ users: [] });
      if (url.endsWith("/subscriptions"))
        return ok({ users: [], workspaces: [] });
      if (url.endsWith("/reports")) return ok({ reports: [] });
      if (url.endsWith("/api-logs")) return ok({ logs: [] });
      if (url.endsWith("/llm-usage")) {
        return ok({
          totals: {
            tokensIn: 0,
            tokensOut: 0,
            cachedTokens: 0,
            costUsd: 0,
            costKrw: 0,
          },
          byModel: [],
          recentEvents: [],
        });
      }
      if (url.includes("/audit-events")) {
        return ok({
          events: [
            {
              id: "audit-1",
              action: "site_admin.grant",
              actorUserId: "admin-1",
              actor: {
                id: "admin-1",
                email: "admin@example.com",
                name: "Admin",
              },
              targetType: "user",
              targetId: "user-1",
              targetUserId: "user-1",
              targetWorkspaceId: null,
              targetReportId: null,
              target: {
                id: "user-1",
                type: "user",
                label: "target@example.com",
                name: "Target",
              },
              before: { isSiteAdmin: false },
              after: { isSiteAdmin: true },
              metadata: { targetEmail: "target@example.com" },
              createdAt: "2026-05-08T00:00:00.000Z",
            },
          ],
          pagination: { limit: 50, offset: 0, nextOffset: null },
        });
      }
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  it("loads and renders admin audit events", async () => {
    render(<AdminUsersClient />);

    expect(await screen.findByText("tabs.audit")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "tabs.audit" }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/audit-events?limit=50&offset=0",
        { cache: "no-store" },
      ),
    );

    expect(await screen.findByText("site_admin.grant")).toBeInTheDocument();
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getByText("target@example.com")).toBeInTheDocument();
    expect(screen.getByText("isSiteAdmin: false -> true")).toBeInTheDocument();
  });
});
