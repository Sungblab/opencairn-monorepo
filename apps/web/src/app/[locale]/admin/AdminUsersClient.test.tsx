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

  it("does not render zero dashboard stats when overview fails", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Internal server error" }),
    } as Response);

    render(<AdminUsersClient />);

    expect(await screen.findByRole("alert")).toHaveTextContent("errors.load");
    expect(screen.queryByText("stats.users")).not.toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("renders a back link to the app", async () => {
    render(<AdminUsersClient returnHref="/ko/dashboard" />);

    const link = await screen.findByRole("link", { name: "actions.backToApp" });
    expect(link).toHaveAttribute("href", "/ko/dashboard");
  });

  it("bulk grants site admin access from the users tab", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input, init) => {
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
      if (url.endsWith("/users")) {
        return ok({
          users: [
            {
              id: "user-1",
              email: "first@example.com",
              name: "First",
              emailVerified: true,
              plan: "free",
              isSiteAdmin: false,
              createdAt: "2026-05-08T00:00:00.000Z",
            },
            {
              id: "user-2",
              email: "second@example.com",
              name: "Second",
              emailVerified: false,
              plan: "free",
              isSiteAdmin: false,
              createdAt: "2026-05-08T00:00:00.000Z",
            },
          ],
        });
      }
      return ok({ updated: 2 });
    });

    render(<AdminUsersClient />);
    fireEvent.click(await screen.findByRole("button", { name: "tabs.users" }));
    const checkboxes = await screen.findAllByLabelText("bulk.selectRow", {
      selector: "input",
    });
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: "bulk.grantSiteAdmin" }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/users/site-admin",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            userIds: ["user-1", "user-2"],
            isSiteAdmin: true,
          }),
        }),
      ),
    );
  });

  it("bulk updates user plans from the subscriptions tab", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
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
      if (url.endsWith("/subscriptions")) {
        return ok({
          users: [
            {
              id: "user-1",
              email: "first@example.com",
              name: "First",
              plan: "free",
              createdAt: "2026-05-08T00:00:00.000Z",
            },
            {
              id: "user-2",
              email: "second@example.com",
              name: "Second",
              plan: "free",
              createdAt: "2026-05-08T00:00:00.000Z",
            },
          ],
          workspaces: [],
        });
      }
      return ok({ updated: 2 });
    });

    render(<AdminUsersClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "tabs.subscriptions" }),
    );
    fireEvent.change(await screen.findByLabelText("bulk.userPlan"), {
      target: { value: "pro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "bulk.applyUserPlan" }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/users/plan",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ userIds: ["user-1", "user-2"], plan: "pro" }),
        }),
      ),
    );
  });
});
