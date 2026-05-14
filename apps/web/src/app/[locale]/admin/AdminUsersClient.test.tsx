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
      if (url.endsWith("/analytics")) {
        return ok({
          generatedAt: "2026-05-15T00:00:00.000Z",
          window: { days: 30, trendDays: 7 },
          overview: {
            users: { total: 4, new30d: 2 },
            content: { workspaces: 3, projects: 8, notes: 22 },
            api: {
              calls30d: 1200,
              failures30d: 3,
              clientErrors30d: 12,
              failureRate30d: 0.3,
              p95DurationMs30d: 820,
            },
            llm: {
              tokens30d: 450000,
              cachedTokens30d: 50000,
              costUsd30d: 3.5,
              costKrw30d: 5775,
            },
          },
          breakdowns: {
            userPlans: [{ label: "max", value: 1, percent: 25 }],
            workspacePlans: [{ label: "pro", value: 2, percent: 66.7 }],
            agentActionStatuses: [
              { label: "failed", value: 2, percent: 40 },
              { label: "approval_required", value: 3, percent: 60 },
            ],
            agentActionKinds30d: [
              { label: "note.update", value: 5, percent: 100 },
            ],
            usageActions: [{ label: "document.generate", value: 9, percent: 100 }],
          },
          operations: {
            health: {
              failedJobs: 1,
              failedImports: 1,
              failedAgentActions: 2,
              approvalRequired: 3,
              openReports: 1,
            },
            riskQueue: [
              {
                id: "risk-1",
                source: "agent_action",
                label: "file.generate",
                status: "failed",
                detail: "provider_timeout",
                createdAt: "2026-05-15T00:00:00.000Z",
                updatedAt: "2026-05-15T00:01:00.000Z",
              },
            ],
          },
          trends: {
            apiCallsDaily: [
              { date: "2026-05-15", total: 1200, failures: 3, avgDurationMs: 42 },
            ],
            llmCostDaily: [
              {
                date: "2026-05-15",
                tokens: 450000,
                costUsd: 3.5,
                costKrw: 5775,
              },
            ],
          },
        });
      }
      if (url.endsWith("/users")) return ok({ users: [] });
      if (url.endsWith("/subscriptions"))
        return ok({ users: [], workspaces: [] });
      if (url.endsWith("/billing"))
        return ok({
          planRevenue: { estimatedMrrKrw: 0, plans: [] },
          creditSummary: {
            totalBalanceCredits: 0,
            zeroBalanceUsers: 0,
            lowBalanceUsers: 0,
            autoRechargeUsers: 0,
          },
          creditByPlan: [],
          lowCreditUsers: [],
          recentLedger: [],
          usage30d: {
            chargedCredits: 0,
            grantedCredits: 0,
            manualGrantCredits: 0,
            subscriptionGrantCredits: 0,
            rawCostUsd: 0,
            rawCostKrw: 0,
            tokensIn: 0,
            tokensOut: 0,
            grossMarginKrw: 0,
          },
          apiHealth30d: {
            total: 0,
            failed: 0,
            clientErrors: 0,
            avgDurationMs: 0,
          },
        });
      if (url.endsWith("/credit-campaigns"))
        return ok({ campaigns: [] });
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

  it("renders hosted readiness signals from the admin overview", async () => {
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
            environment: "production",
            internalApiUrl: "http://api:4000",
            publicAppUrl: "https://opencairn.com",
            email: { resendConfigured: true, smtpConfigured: false },
            storage: { s3Configured: true },
            featureFlags: {},
            readiness: {
              email: true,
              objectStorage: true,
              sentry: true,
              googleAnalytics: true,
              metaPixel: true,
              geminiApi: true,
              geminiSpendCap: true,
              databaseBackups: false,
            },
          },
        });
      }
      return ok({ users: [] });
    });

    render(<AdminUsersClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "tabs.readiness" }),
    );

    expect(await screen.findByText("readiness.email")).toBeInTheDocument();
    expect(screen.getByText("readiness.databaseBackups")).toBeInTheDocument();
    expect(screen.getAllByText("readiness.ready").length).toBeGreaterThan(0);
    expect(screen.getByText("readiness.needsSetup")).toBeInTheDocument();
  });

  it("hides hosted-only admin tabs when hosted service mode is disabled", async () => {
    render(<AdminUsersClient hostedService={false} />);

    expect(
      await screen.findByRole("button", { name: "tabs.dashboard" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tabs.billing" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tabs.promotions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tabs.readiness" }),
    ).not.toBeInTheDocument();
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

  it("applies subscription bulk actions only to the filtered plan rows", async () => {
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
              id: "user-free",
              email: "free@example.com",
              name: "Free User",
              plan: "free",
              balanceCredits: 0,
              monthlyGrantCredits: 0,
              createdAt: "2026-05-08T00:00:00.000Z",
            },
            {
              id: "user-pro",
              email: "pro@example.com",
              name: "Pro User",
              plan: "pro",
              balanceCredits: 8000,
              monthlyGrantCredits: 8000,
              createdAt: "2026-05-08T00:00:00.000Z",
            },
          ],
          workspaces: [],
        });
      }
      return ok({ updated: 1 });
    });

    render(<AdminUsersClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "tabs.subscriptions" }),
    );
    fireEvent.change(await screen.findByLabelText("filters.userPlan"), {
      target: { value: "free" },
    });
    fireEvent.change(await screen.findByLabelText("bulk.userPlan"), {
      target: { value: "pro" },
    });
    fireEvent.click(screen.getByRole("button", { name: "bulk.applyUserPlan" }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/users/plan",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ userIds: ["user-free"], plan: "pro" }),
        }),
      ),
    );
  });

  it("formats large dashboard numbers compactly", async () => {
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/overview")) {
        return ok({
          stats: {
            users: 1200,
            workspaces: 10,
            projects: 13,
            openReports: 0,
            failedJobs: 0,
            pendingEmails: 4,
            notes: 15,
            usageThisMonth: 315000,
            apiCallsToday: 854,
            llmCostKrw30d: 17338,
          },
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
      return ok({ users: [], workspaces: [], reports: [] });
    });

    render(<AdminUsersClient />);

    expect(await screen.findByText("1.2K")).toBeInTheDocument();
    expect(screen.getByText("315K")).toBeInTheDocument();
  });

  it("renders the detailed analytics command center", async () => {
    render(<AdminUsersClient />);

    fireEvent.click(await screen.findByRole("button", { name: "tabs.analytics" }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith("/api/admin/analytics", {
        cache: "no-store",
      }),
    );
    expect(await screen.findByText("analytics.sections.commandCenter")).toBeInTheDocument();
    expect(screen.getByText("analytics.metrics.apiFailureRate")).toBeInTheDocument();
    expect(screen.getByText("analytics.sections.riskQueue")).toBeInTheDocument();
    expect(screen.getByText("file.generate")).toBeInTheDocument();
    expect(screen.getByText("provider_timeout")).toBeInTheDocument();
    expect(screen.getByText("note.update")).toBeInTheDocument();
  });

  it("renders billing operations metrics", async () => {
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
      if (url.endsWith("/billing")) {
        return ok({
          planRevenue: {
            estimatedMrrKrw: 9900,
            plans: [
              {
                plan: "pro",
                users: 1,
                monthlyPriceKrw: 9900,
                estimatedMrrKrw: 9900,
                includedMonthlyCredits: 8000,
              },
            ],
          },
          creditSummary: {
            totalBalanceCredits: 300,
            zeroBalanceUsers: 0,
            lowBalanceUsers: 1,
            autoRechargeUsers: 0,
          },
          creditByPlan: [
            {
              plan: "pro",
              users: 1,
              balanceCredits: 300,
              monthlyGrantCredits: 8000,
            },
          ],
          lowCreditUsers: [
            {
              id: "user-low",
              email: "low@example.com",
              name: "Low",
              plan: "pro",
              balanceCredits: 300,
              monthlyGrantCredits: 8000,
            },
          ],
          recentLedger: [],
          usage30d: {
            chargedCredits: 1200,
            grantedCredits: 2500,
            manualGrantCredits: 2500,
            subscriptionGrantCredits: 0,
            rawCostUsd: 0.5,
            rawCostKrw: 825,
            tokensIn: 1000,
            tokensOut: 1000,
            grossMarginKrw: 375,
          },
          apiHealth30d: {
            total: 20,
            failed: 1,
            clientErrors: 2,
            avgDurationMs: 32,
          },
        });
      }
      return ok({ users: [], workspaces: [], reports: [] });
    });

    render(<AdminUsersClient />);
    fireEvent.click(await screen.findByRole("button", { name: "tabs.billing" }));

    expect(await screen.findByText("billing.mrr")).toBeInTheDocument();
    expect(screen.getByText("low@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("pro · 1").length).toBeGreaterThanOrEqual(1);
  });

  it("creates a promotion campaign and grants it to filtered users", async () => {
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
      if (url.endsWith("/subscriptions")) {
        return ok({
          users: [
            {
              id: "user-free",
              email: "free@example.com",
              name: "Free User",
              plan: "free",
              balanceCredits: 0,
              monthlyGrantCredits: 0,
              createdAt: "2026-05-08T00:00:00.000Z",
            },
          ],
          workspaces: [],
        });
      }
      if (url.endsWith("/credit-campaigns") && init?.method !== "POST") {
        return ok({
          campaigns: [
            {
              id: "campaign-1",
              name: "Launch promo",
              code: "LAUNCH",
              status: "active",
              creditAmount: 2500,
              targetPlan: "free",
              maxRedemptions: 10,
              redeemedCount: 0,
              startsAt: null,
              endsAt: null,
              createdAt: "2026-05-08T00:00:00.000Z",
              updatedAt: "2026-05-08T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.endsWith("/billing")) {
        return ok({
          planRevenue: { estimatedMrrKrw: 0, plans: [] },
          creditSummary: {
            totalBalanceCredits: 0,
            zeroBalanceUsers: 0,
            lowBalanceUsers: 0,
            autoRechargeUsers: 0,
          },
          creditByPlan: [],
          lowCreditUsers: [],
          recentLedger: [],
          usage30d: {
            chargedCredits: 0,
            grantedCredits: 0,
            manualGrantCredits: 0,
            subscriptionGrantCredits: 0,
            rawCostUsd: 0,
            rawCostKrw: 0,
            tokensIn: 0,
            tokensOut: 0,
            grossMarginKrw: 0,
          },
          apiHealth30d: {
            total: 0,
            failed: 0,
            clientErrors: 0,
            avgDurationMs: 0,
          },
        });
      }
      return ok({ campaign: { id: "campaign-1" }, granted: 1, skipped: 0 });
    });

    render(<AdminUsersClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "tabs.promotions" }),
    );
    fireEvent.change(await screen.findByPlaceholderText("promotions.name"), {
      target: { value: "Launch promo" },
    });
    fireEvent.change(screen.getByPlaceholderText("promotions.code"), {
      target: { value: "LAUNCH" },
    });
    fireEvent.click(screen.getByRole("button", { name: "promotions.createAction" }));

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/credit-campaigns",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Launch promo"),
        }),
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "promotions.grantFiltered",
      }),
    );

    await waitFor(() =>
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/admin/credit-campaigns/campaign-1/grant",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            userIds: ["user-free"],
            reason: "LAUNCH",
          }),
        }),
      ),
    );
  });
});
