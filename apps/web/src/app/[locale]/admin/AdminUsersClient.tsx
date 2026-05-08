"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bug,
  CheckCircle2,
  CreditCard,
  Database,
  Mail,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type TabKey =
  | "dashboard"
  | "analytics"
  | "users"
  | "subscriptions"
  | "reports"
  | "audit"
  | "logs"
  | "email"
  | "system";
type ExtendedTabKey = TabKey | "apiLogs" | "llmCosts";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  plan: "free" | "pro" | "byok";
  isSiteAdmin: boolean;
  createdAt: string;
}

interface AdminWorkspaceSubscription {
  id: string;
  slug: string;
  name: string;
  planType: "free" | "pro" | "enterprise";
  ownerId: string;
  createdAt: string;
}

interface AdminReport {
  id: string;
  reporterUserId: string | null;
  type: string;
  priority: string;
  status: "open" | "triaged" | "resolved" | "closed";
  title: string;
  description: string;
  pageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface AdminOverview {
  stats: Record<string, number>;
  analytics: {
    userPlans: Array<{ plan: string; value: number }>;
    workspacePlans: Array<{ plan: string; value: number }>;
    actionStatuses: Array<{ status: string; value: number }>;
    usageByAction: Array<{ action: string; value: number }>;
  };
  recentReports: Array<
    Pick<
      AdminReport,
      "id" | "title" | "type" | "priority" | "status" | "createdAt"
    >
  >;
  recentOperations: Array<{
    id: string;
    source: string;
    label: string;
    status: string;
    detail: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  system: {
    environment: string;
    internalApiUrl: string | null;
    publicAppUrl: string | null;
    email: { resendConfigured: boolean; smtpConfigured: boolean };
    storage: { s3Configured: boolean };
    featureFlags: Record<string, boolean>;
  };
}

interface ApiRequestLog {
  id: string;
  method: string;
  path: string;
  query: string | null;
  statusCode: number;
  durationMs: number;
  userId: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface LlmUsageSummary {
  totals: {
    tokensIn: number;
    tokensOut: number;
    cachedTokens: number;
    costUsd: number;
    costKrw: number;
  };
  byModel: Array<{
    provider: string;
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    costKrw: number;
  }>;
  recentEvents: Array<{
    id: string;
    provider: string;
    model: string;
    operation: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    costKrw: number;
    userId: string | null;
    createdAt: string;
  }>;
}

interface AdminAuditEvent {
  id: string;
  actorUserId: string | null;
  actor: {
    id: string;
    email: string | null;
    name: string | null;
  } | null;
  action: string;
  targetType: string;
  targetId: string;
  targetUserId: string | null;
  targetWorkspaceId: string | null;
  targetReportId: string | null;
  target: {
    id: string;
    type: string;
    label: string;
    name: string | null;
  };
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface AuditEventsResponse {
  events: AdminAuditEvent[];
  pagination: {
    limit: number;
    offset: number;
    nextOffset: number | null;
  };
}

const tabs: Array<{ key: ExtendedTabKey; icon: typeof Activity }> = [
  { key: "dashboard", icon: Activity },
  { key: "analytics", icon: BarChart3 },
  { key: "users", icon: Users },
  { key: "subscriptions", icon: CreditCard },
  { key: "reports", icon: Bug },
  { key: "audit", icon: Shield },
  { key: "logs", icon: Database },
  { key: "apiLogs", icon: ReceiptText },
  { key: "llmCosts", icon: Activity },
  { key: "email", icon: Mail },
  { key: "system", icon: Settings },
];

const PAGE_SIZE_OPTIONS = [15, 30, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 30;

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatUsd(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(value);
}

function formatKrw(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function StatusPill({ value }: { value: string }) {
  const tone = ["failed", "urgent", "open"].includes(value)
    ? "border-destructive text-destructive"
    : ["completed", "resolved", "active"].includes(value)
      ? "border-green-600 text-green-700 dark:text-green-400"
      : "border-border text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center border px-2 text-xs font-semibold uppercase",
        tone,
      )}
    >
      {value}
    </span>
  );
}

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="border border-border bg-card">
      <div className="flex min-h-11 items-center justify-between border-b border-border bg-muted/40 px-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

function ScrollBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-[min(68vh,720px)] overflow-auto overscroll-contain">
      {children}
    </div>
  );
}

function slicePage<T>(rows: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(0, page), pageCount - 1);
  return rows.slice(safePage * pageSize, safePage * pageSize + pageSize);
}

function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const t = useTranslations("admin");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const start = total === 0 ? 0 : currentPage * pageSize + 1;
  const end = Math.min(total, (currentPage + 1) * pageSize);

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <div className="tabular-nums">
        {t("pagination.range", { start, end, total })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-semibold uppercase">
          {t("pagination.pageSize")}
        </label>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-8 border border-border bg-background px-2 text-sm"
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          {t("pagination.previous")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={currentPage >= pageCount - 1}
          onClick={() => onPageChange(currentPage + 1)}
        >
          {t("pagination.next")}
        </Button>
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  critical,
}: {
  label: string;
  value: number;
  critical?: boolean;
}) {
  return (
    <div
      className={cn(
        "border bg-background p-3",
        critical ? "border-destructive" : "border-border",
      )}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-2 text-3xl font-bold tabular-nums",
          critical ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function AdminUsersClient() {
  const t = useTranslations("admin");
  const [activeTab, setActiveTab] = useState<ExtendedTabKey>("dashboard");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [subscriptionUsers, setSubscriptionUsers] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspaceSubscription[]>(
    [],
  );
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([]);
  const [apiLogs, setApiLogs] = useState<ApiRequestLog[]>([]);
  const [llmUsage, setLlmUsage] = useState<LlmUsageSummary | null>(null);
  const [auditNextOffset, setAuditNextOffset] = useState<number | null>(0);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function fetchJson<T>(path: string): Promise<T | null> {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  }

  async function loadOverview() {
    const body = await fetchJson<AdminOverview>("/api/admin/overview");
    if (!body) return false;
    setOverview(body);
    return true;
  }

  async function loadUsers() {
    const body = await fetchJson<{ users: AdminUser[] }>("/api/admin/users");
    if (!body) return false;
    setUsers(body.users);
    return true;
  }

  async function loadSubscriptions() {
    const body = await fetchJson<{
      users: AdminUser[];
      workspaces: AdminWorkspaceSubscription[];
    }>("/api/admin/subscriptions");
    if (!body) return false;
    setSubscriptionUsers(body.users);
    setWorkspaces(body.workspaces);
    return true;
  }

  async function loadReports() {
    const body = await fetchJson<{ reports: AdminReport[] }>(
      "/api/admin/reports",
    );
    if (!body) return false;
    setReports(body.reports);
    return true;
  }

  async function loadAuditEvents(reset = false) {
    const offset = reset ? 0 : (auditNextOffset ?? 0);
    if (!reset && auditNextOffset === null) return true;
    const body = await fetchJson<AuditEventsResponse>(
      `/api/admin/audit-events?limit=50&offset=${offset}`,
    );
    if (!body) return false;
    setAuditEvents((current) =>
      reset ? body.events : [...current, ...body.events],
    );
    setAuditNextOffset(body.pagination.nextOffset);
    return true;
  }

  async function loadApiLogs() {
    const body = await fetchJson<{ logs: ApiRequestLog[] }>(
      "/api/admin/api-logs",
    );
    if (!body) return false;
    setApiLogs(body.logs);
    return true;
  }

  async function loadLlmUsage() {
    const body = await fetchJson<LlmUsageSummary>("/api/admin/llm-usage");
    if (!body) return false;
    setLlmUsage(body);
    return true;
  }

  async function loadInitial() {
    setError(null);
    const ok = await loadOverview();
    if (!ok) {
      setError(t("errors.load"));
    }
  }

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    async function loadActiveTab() {
      setError(null);
      let ok = true;
      if (activeTab === "dashboard" && !overview) {
        ok = await loadOverview();
      }
      if (activeTab === "analytics" && !overview) {
        ok = await loadOverview();
      }
      if (activeTab === "users" && users.length === 0) {
        ok = await loadUsers();
      }
      if (
        activeTab === "subscriptions" &&
        subscriptionUsers.length === 0 &&
        workspaces.length === 0
      ) {
        ok = await loadSubscriptions();
      }
      if (activeTab === "reports" && reports.length === 0) {
        ok = await loadReports();
      }
      if (activeTab === "logs" && !overview) {
        ok = await loadOverview();
      }
      if (activeTab === "email" && !overview) {
        ok = await loadOverview();
      }
      if (activeTab === "system" && !overview) {
        ok = await loadOverview();
      }
      if (activeTab === "audit" && auditEvents.length === 0) {
        ok = await loadAuditEvents(true);
      }
      if (activeTab === "apiLogs" && apiLogs.length === 0) {
        ok = await loadApiLogs();
      }
      if (activeTab === "llmCosts" && !llmUsage) {
        ok = await loadLlmUsage();
      }
      if (!ok) setError(t("errors.load"));
    }

    void loadActiveTab();
  }, [activeTab]);

  useEffect(() => {
    setPageFor("users", 0);
  }, [query]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      `${user.name} ${user.email} ${user.plan}`.toLowerCase().includes(needle),
    );
  }, [query, users]);

  function pageFor(key: string) {
    return pages[key] ?? 0;
  }

  function setPageFor(key: string, page: number) {
    setPages((current) => ({ ...current, [key]: Math.max(0, page) }));
  }

  function handlePageSizeChange(nextPageSize: number) {
    setPageSize(nextPageSize);
    setPages({});
  }

  const pagedUsers = slicePage(filteredUsers, pageFor("users"), pageSize);
  const pagedSubscriptionUsers = slicePage(
    subscriptionUsers,
    pageFor("subscriptionUsers"),
    pageSize,
  );
  const pagedWorkspaces = slicePage(workspaces, pageFor("workspaces"), pageSize);
  const pagedReports = slicePage(reports, pageFor("reports"), pageSize);
  const pagedOperations = slicePage(
    overview?.recentOperations ?? [],
    pageFor("operations"),
    pageSize,
  );
  const pagedApiLogs = slicePage(apiLogs, pageFor("apiLogs"), pageSize);
  const pagedLlmEvents = slicePage(
    llmUsage?.recentEvents ?? [],
    pageFor("llmEvents"),
    pageSize,
  );

  async function patch(
    path: string,
    body: unknown,
    refresh: () => Promise<unknown>,
  ) {
    setBusy(path);
    setError(null);
    const res = await fetch(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      setError(t("errors.update"));
      return false;
    }
    await refresh();
    if (activeTab === "audit") await loadAuditEvents(true);
    return true;
  }

  const stats = overview?.stats ?? {};

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border border-border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
        <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("navigation")}
        </div>
        <nav className="grid p-2">
          {tabs.map(({ key, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={cn(
                "flex h-10 items-center gap-2 border px-3 text-left text-sm font-semibold",
                activeTab === key
                  ? "border-foreground bg-foreground text-background"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-muted",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {t(`tabs.${key}`)}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 space-y-4">
        {error && (
          <div
            role="alert"
            className="border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {activeTab === "dashboard" && (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <StatBox label={t("stats.users")} value={stats.users ?? 0} />
              <StatBox
                label={t("stats.workspaces")}
                value={stats.workspaces ?? 0}
              />
              <StatBox
                label={t("stats.projects")}
                value={stats.projects ?? 0}
              />
              <StatBox
                label={t("stats.openReports")}
                value={stats.openReports ?? 0}
                critical={(stats.openReports ?? 0) > 0}
              />
              <StatBox
                label={t("stats.failedJobs")}
                value={stats.failedJobs ?? 0}
                critical={(stats.failedJobs ?? 0) > 0}
              />
              <StatBox
                label={t("stats.pendingEmails")}
                value={stats.pendingEmails ?? 0}
                critical={(stats.pendingEmails ?? 0) > 0}
              />
              <StatBox label={t("stats.notes")} value={stats.notes ?? 0} />
              <StatBox
                label={t("stats.usageThisMonth")}
                value={stats.usageThisMonth ?? 0}
              />
              <StatBox
                label={t("stats.apiCallsToday")}
                value={stats.apiCallsToday ?? 0}
              />
              <StatBox
                label={t("stats.llmCostKrw30d")}
                value={Math.round(stats.llmCostKrw30d ?? 0)}
              />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title={t("sections.reports")}>
                <CompactReportList reports={overview?.recentReports ?? []} />
              </Panel>
              <Panel title={t("sections.operations")}>
                <OperationList
                  operations={overview?.recentOperations.slice(0, 8) ?? []}
                />
              </Panel>
            </div>
          </>
        )}

        {activeTab === "analytics" && (
          overview ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <BreakdownPanel
                title={t("sections.userPlans")}
                rows={overview.analytics.userPlans}
                labelKey="plan"
              />
              <BreakdownPanel
                title={t("sections.workspacePlans")}
                rows={overview.analytics.workspacePlans}
                labelKey="plan"
              />
              <BreakdownPanel
                title={t("sections.actionStatuses")}
                rows={overview.analytics.actionStatuses}
                labelKey="status"
              />
              <BreakdownPanel
                title={t("sections.usage")}
                rows={overview.analytics.usageByAction}
                labelKey="action"
              />
            </div>
          ) : (
            <Panel title={t("tabs.analytics")}>
              <Empty />
            </Panel>
          )
        )}

        {activeTab === "users" && (
          <Panel
            title={t("sections.users")}
            action={
              <div className="relative w-56">
                <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("searchUsers")}
                  className="h-8 rounded-none pl-8"
                />
              </div>
            }
          >
            <ScrollBox>
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2">{t("columns.user")}</th>
                    <th className="px-3 py-2">{t("columns.plan")}</th>
                    <th className="px-3 py-2">{t("columns.verified")}</th>
                    <th className="px-3 py-2">{t("columns.created")}</th>
                    <th className="px-3 py-2 text-right">
                      {t("columns.siteAdmin")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.map((user) => (
                    <tr key={user.id} className="border-b border-border">
                      <td className="px-3 py-2">
                        <div className="font-semibold">{user.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {user.email}
                        </div>
                      </td>
                      <td className="px-3 py-2 uppercase">{user.plan}</td>
                      <td className="px-3 py-2">
                        {user.emailVerified
                          ? t("verified.yes")
                          : t("verified.no")}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          variant={user.isSiteAdmin ? "destructive" : "outline"}
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            void patch(
                              `/api/admin/users/${user.id}/site-admin`,
                              { isSiteAdmin: !user.isSiteAdmin },
                              async () => {
                                await Promise.all([
                                  loadUsers(),
                                  loadOverview(),
                                ]);
                              },
                            )
                          }
                        >
                          {user.isSiteAdmin
                            ? t("actions.revoke")
                            : t("actions.grant")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollBox>
            <PaginationControls
              page={pageFor("users")}
              pageSize={pageSize}
              total={filteredUsers.length}
              onPageChange={(page) => setPageFor("users", page)}
              onPageSizeChange={handlePageSizeChange}
            />
          </Panel>
        )}

        {activeTab === "subscriptions" && (
          <div className="grid gap-4 xl:grid-cols-2">
            <PlanTable
              title={t("sections.userSubscriptions")}
              rows={pagedSubscriptionUsers}
              totalRows={subscriptionUsers.length}
              page={pageFor("subscriptionUsers")}
              pageSize={pageSize}
              onPageChange={(page) => setPageFor("subscriptionUsers", page)}
              onPageSizeChange={handlePageSizeChange}
              idPrefix="user"
              options={["free", "pro", "byok"]}
              getValue={(row) => row.plan}
              getName={(row) => row.name}
              getMeta={(row) => row.email}
              onChange={(row, plan) =>
                patch(`/api/admin/users/${row.id}/plan`, { plan }, async () => {
                  await Promise.all([loadSubscriptions(), loadOverview()]);
                })
              }
              busy={busy !== null}
            />
            <PlanTable
              title={t("sections.workspaceSubscriptions")}
              rows={pagedWorkspaces}
              totalRows={workspaces.length}
              page={pageFor("workspaces")}
              pageSize={pageSize}
              onPageChange={(page) => setPageFor("workspaces", page)}
              onPageSizeChange={handlePageSizeChange}
              idPrefix="workspace"
              options={["free", "pro", "enterprise"]}
              getValue={(row) => row.planType}
              getName={(row) => row.name}
              getMeta={(row) => row.slug}
              onChange={(row, planType) =>
                patch(
                  `/api/admin/workspaces/${row.id}/plan`,
                  { planType },
                  async () => {
                    await Promise.all([loadSubscriptions(), loadOverview()]);
                  },
                )
              }
              busy={busy !== null}
            />
          </div>
        )}

        {activeTab === "reports" && (
          <Panel title={t("sections.reports")}>
            <ScrollBox>
              <div className="space-y-2">
              {pagedReports.map((report) => (
                <div
                  key={report.id}
                  className="grid gap-3 border border-border bg-background p-3 lg:grid-cols-[1fr_180px]"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill value={report.status} />
                      <StatusPill value={report.priority} />
                      <span className="text-xs uppercase text-muted-foreground">
                        {report.type}
                      </span>
                    </div>
                    <h3 className="mt-2 font-bold">{report.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {report.description || t("emptyDescription")}
                    </p>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {formatDate(report.createdAt)} · {report.pageUrl ?? "-"}
                    </div>
                  </div>
                  <div className="grid content-start gap-2">
                    {(["open", "triaged", "resolved", "closed"] as const).map(
                      (status) => (
                        <Button
                          key={status}
                          type="button"
                          variant={
                            report.status === status ? "default" : "outline"
                          }
                          size="sm"
                          disabled={busy !== null}
                          onClick={() =>
                            void patch(
                              `/api/admin/reports/${report.id}/status`,
                              { status },
                              async () => {
                                await Promise.all([
                                  loadReports(),
                                  loadOverview(),
                                ]);
                              },
                            )
                          }
                        >
                          {t(`reportStatuses.${status}`)}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              ))}
              </div>
            </ScrollBox>
            <PaginationControls
              page={pageFor("reports")}
              pageSize={pageSize}
              total={reports.length}
              onPageChange={(page) => setPageFor("reports", page)}
              onPageSizeChange={handlePageSizeChange}
            />
          </Panel>
        )}

        {activeTab === "audit" && (
          <Panel
            title={t("sections.audit")}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadAuditEvents(true)}
              >
                <RefreshCw className="h-4 w-4" />
                {t("actions.refresh")}
              </Button>
            }
          >
            <AuditEventTable
              events={auditEvents}
              hasMore={auditNextOffset !== null}
              onLoadMore={() => void loadAuditEvents(false)}
            />
          </Panel>
        )}

        {activeTab === "logs" && (
          <Panel
            title={t("sections.operations")}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadOverview()}
              >
                <RefreshCw className="h-4 w-4" />
                {t("actions.refresh")}
              </Button>
            }
          >
            <OperationList operations={pagedOperations} />
            <PaginationControls
              page={pageFor("operations")}
              pageSize={pageSize}
              total={overview?.recentOperations.length ?? 0}
              onPageChange={(page) => setPageFor("operations", page)}
              onPageSizeChange={handlePageSizeChange}
            />
          </Panel>
        )}

        {activeTab === "apiLogs" && (
          <Panel
            title={t("sections.apiLogs")}
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadApiLogs()}
              >
                <RefreshCw className="h-4 w-4" />
                {t("actions.refresh")}
              </Button>
            }
          >
            <ApiLogTable logs={pagedApiLogs} />
            <PaginationControls
              page={pageFor("apiLogs")}
              pageSize={pageSize}
              total={apiLogs.length}
              onPageChange={(page) => setPageFor("apiLogs", page)}
              onPageSizeChange={handlePageSizeChange}
            />
          </Panel>
        )}

        {activeTab === "llmCosts" && (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <StatBox
                label={t("llm.tokensIn")}
                value={llmUsage?.totals.tokensIn ?? 0}
              />
              <StatBox
                label={t("llm.tokensOut")}
                value={llmUsage?.totals.tokensOut ?? 0}
              />
              <StatBox
                label={t("llm.costUsd")}
                value={Number((llmUsage?.totals.costUsd ?? 0).toFixed(4))}
              />
              <StatBox
                label={t("llm.costKrw")}
                value={Math.round(llmUsage?.totals.costKrw ?? 0)}
              />
            </div>
            <Panel title={t("sections.llmByModel")}>
              <LlmModelTable rows={llmUsage?.byModel ?? []} />
            </Panel>
            <Panel title={t("sections.llmEvents")}>
              <LlmEventTable rows={pagedLlmEvents} />
              <PaginationControls
                page={pageFor("llmEvents")}
                pageSize={pageSize}
                total={llmUsage?.recentEvents.length ?? 0}
                onPageChange={(page) => setPageFor("llmEvents", page)}
                onPageSizeChange={handlePageSizeChange}
              />
            </Panel>
          </div>
        )}

        {activeTab === "email" && (
          overview ? (
            <Panel title={t("sections.email")}>
              <div className="grid gap-2 md:grid-cols-3">
                <ConfigBox
                  icon={Mail}
                  label={t("email.resend")}
                  ok={overview.system.email.resendConfigured}
                />
                <ConfigBox
                  icon={Mail}
                  label={t("email.smtp")}
                  ok={overview.system.email.smtpConfigured}
                />
                <ConfigBox
                  icon={AlertTriangle}
                  label={t("email.pending")}
                  ok={(stats.pendingEmails ?? 0) === 0}
                  detail={`${stats.pendingEmails ?? 0}`}
                />
              </div>
            </Panel>
          ) : (
            <Panel title={t("sections.email")}>
              <Empty />
            </Panel>
          )
        )}

        {activeTab === "system" && (
          overview ? (
            <Panel title={t("sections.system")}>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <ConfigBox
                  icon={Shield}
                  label={t("system.environment")}
                  ok
                  detail={overview.system.environment}
                />
                <ConfigBox
                  icon={Database}
                  label={t("system.storage")}
                  ok={overview.system.storage.s3Configured}
                />
                {Object.entries(overview.system.featureFlags).map(
                  ([key, value]) => (
                    <ConfigBox
                      key={key}
                      icon={CheckCircle2}
                      label={key}
                      ok={value}
                    />
                  ),
                )}
              </div>
            </Panel>
          ) : (
            <Panel title={t("sections.system")}>
              <Empty />
            </Panel>
          )
        )}
      </div>
    </div>
  );
}

function CompactReportList({
  reports,
}: {
  reports: AdminOverview["recentReports"];
}) {
  if (reports.length === 0) return <Empty />;
  return (
    <div className="space-y-2">
      {reports.map((report) => (
        <div
          key={report.id}
          className="flex items-start justify-between gap-3 border border-border bg-background p-2"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{report.title}</div>
            <div className="text-xs text-muted-foreground">
              {report.type} · {formatDate(report.createdAt)}
            </div>
          </div>
          <StatusPill value={report.status} />
        </div>
      ))}
    </div>
  );
}

function OperationList({
  operations,
}: {
  operations: AdminOverview["recentOperations"];
}) {
  if (operations.length === 0) return <Empty />;
  return (
    <ScrollBox>
      <table className="min-w-full text-sm">
        <tbody>
          {operations.map((op) => (
            <tr
              key={`${op.source}:${op.id}`}
              className="border-b border-border last:border-0"
            >
              <td className="whitespace-nowrap px-2 py-2 text-xs font-semibold uppercase text-muted-foreground">
                {op.source}
              </td>
              <td className="px-2 py-2 font-medium">{op.label}</td>
              <td className="px-2 py-2">
                <StatusPill value={op.status} />
              </td>
              <td className="px-2 py-2 text-muted-foreground">
                {op.detail ?? "-"}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right text-xs tabular-nums text-muted-foreground">
                {formatDate(op.updatedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
  );
}

function ApiLogTable({ logs }: { logs: ApiRequestLog[] }) {
  const t = useTranslations("admin");
  if (logs.length === 0) return <Empty />;
  return (
    <ScrollBox>
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="px-2 py-2">{t("columns.time")}</th>
            <th className="px-2 py-2">{t("columns.method")}</th>
            <th className="px-2 py-2">{t("columns.path")}</th>
            <th className="px-2 py-2">{t("columns.status")}</th>
            <th className="px-2 py-2">{t("columns.duration")}</th>
            <th className="px-2 py-2">{t("columns.user")}</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-muted-foreground">
                {formatDate(log.createdAt)}
              </td>
              <td className="px-2 py-2 font-semibold">{log.method}</td>
              <td className="max-w-[420px] truncate px-2 py-2 font-mono text-xs">
                {log.path}
                {log.query ? `?${log.query}` : ""}
              </td>
              <td className="px-2 py-2">
                <StatusPill value={String(log.statusCode)} />
              </td>
              <td className="px-2 py-2 tabular-nums">
                {log.durationMs}
                {t("units.ms")}
              </td>
              <td className="max-w-[180px] truncate px-2 py-2 text-xs text-muted-foreground">
                {log.userId ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
  );
}

function auditActorLabel(event: AdminAuditEvent) {
  return event.actor?.email ?? event.actor?.name ?? event.actorUserId ?? "-";
}

function auditTargetLabel(event: AdminAuditEvent) {
  const metadataLabel =
    typeof event.metadata.targetEmail === "string"
      ? event.metadata.targetEmail
      : typeof event.metadata.workspaceSlug === "string"
        ? event.metadata.workspaceSlug
        : typeof event.metadata.reportTitle === "string"
          ? event.metadata.reportTitle
          : null;
  return metadataLabel ?? event.target.label ?? event.targetId;
}

function formatAuditValue(value: unknown) {
  if (value === null || value === undefined) return "-";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatAuditChange(event: AdminAuditEvent) {
  const keys = Array.from(
    new Set([...Object.keys(event.before), ...Object.keys(event.after)]),
  );
  if (keys.length === 0) return "-";
  return keys
    .map(
      (key) =>
        `${key}: ${formatAuditValue(event.before[key])} -> ${formatAuditValue(
          event.after[key],
        )}`,
    )
    .join(", ");
}

function AuditEventTable({
  events,
  hasMore,
  onLoadMore,
}: {
  events: AdminAuditEvent[];
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  const t = useTranslations("admin");
  if (events.length === 0) return <Empty />;
  return (
    <div className="space-y-3">
      <ScrollBox>
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="px-2 py-2">{t("columns.time")}</th>
              <th className="px-2 py-2">{t("columns.action")}</th>
              <th className="px-2 py-2">{t("columns.actor")}</th>
              <th className="px-2 py-2">{t("columns.target")}</th>
              <th className="px-2 py-2">{t("columns.beforeAfter")}</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr
                key={event.id}
                className="border-b border-border last:border-0"
              >
                <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-muted-foreground">
                  {formatDate(event.createdAt)}
                </td>
                <td className="px-2 py-2 font-semibold">{event.action}</td>
                <td className="max-w-[220px] truncate px-2 py-2 text-xs">
                  {auditActorLabel(event)}
                </td>
                <td className="max-w-[260px] truncate px-2 py-2 text-xs">
                  {auditTargetLabel(event)}
                </td>
                <td className="max-w-[420px] truncate px-2 py-2 text-xs text-muted-foreground">
                  {formatAuditChange(event)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollBox>
      {hasMore && (
        <Button type="button" variant="outline" size="sm" onClick={onLoadMore}>
          {t("actions.loadMore")}
        </Button>
      )}
    </div>
  );
}

function LlmModelTable({ rows }: { rows: LlmUsageSummary["byModel"] }) {
  const t = useTranslations("admin");
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.provider}:${row.model}`}
              className="border-b border-border last:border-0"
            >
              <td className="px-2 py-2 font-semibold">{row.provider}</td>
              <td className="px-2 py-2 font-mono text-xs">{row.model}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {row.tokensIn + row.tokensOut}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {formatUsd(row.costUsd)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {formatKrw(row.costKrw)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sr-only">{t("sections.llmByModel")}</div>
    </div>
  );
}

function LlmEventTable({ rows }: { rows: LlmUsageSummary["recentEvents"] }) {
  if (rows.length === 0) return <Empty />;
  return (
    <ScrollBox>
      <table className="min-w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-border last:border-0">
              <td className="whitespace-nowrap px-2 py-2 text-xs tabular-nums text-muted-foreground">
                {formatDate(row.createdAt)}
              </td>
              <td className="px-2 py-2 font-semibold">{row.operation}</td>
              <td className="px-2 py-2 font-mono text-xs">{row.model}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {row.tokensIn + row.tokensOut}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {formatUsd(row.costUsd)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {formatKrw(row.costKrw)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
  );
}

function BreakdownPanel({
  title,
  rows,
  labelKey,
}: {
  title: string;
  rows: Array<Record<string, string | number>>;
  labelKey: string;
}) {
  const total = rows.reduce((sum, row) => sum + Number(row.value ?? 0), 0);
  return (
    <Panel title={title}>
      <div className="space-y-3">
        {rows.length === 0 ? (
          <Empty />
        ) : (
          rows.map((row) => {
            const value = Number(row.value ?? 0);
            const pct = total > 0 ? Math.round((value / total) * 100) : 0;
            return (
              <div key={String(row[labelKey])}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold">{String(row[labelKey])}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {value} · {pct}%
                  </span>
                </div>
                <div className="h-3 border border-border bg-background">
                  <div
                    className="h-full bg-foreground"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

function PlanTable<T extends { id: string }>({
  title,
  rows,
  totalRows,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  options,
  getValue,
  getName,
  getMeta,
  onChange,
  busy,
}: {
  title: string;
  rows: T[];
  totalRows: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  idPrefix: string;
  options: string[];
  getValue: (row: T) => string;
  getName: (row: T) => string;
  getMeta: (row: T) => string;
  onChange: (row: T, value: string) => Promise<unknown>;
  busy: boolean;
}) {
  return (
    <Panel title={title}>
      <div className="space-y-3">
        <ScrollBox>
          <div className="space-y-2">
            {rows.length === 0 ? (
              <Empty />
            ) : (
              rows.map((row) => (
                <div
                  key={row.id}
                  className="grid gap-2 border border-border bg-background p-2 sm:grid-cols-[1fr_150px]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">
                      {getName(row)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {getMeta(row)}
                    </div>
                  </div>
                  <select
                    value={getValue(row)}
                    disabled={busy}
                    onChange={(event) => void onChange(row, event.target.value)}
                    className="h-9 border border-border bg-background px-2 text-sm font-semibold uppercase"
                  >
                    {options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              ))
            )}
          </div>
        </ScrollBox>
        <PaginationControls
          page={page}
          pageSize={pageSize}
          total={totalRows}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      </div>
    </Panel>
  );
}

function ConfigBox({
  icon: Icon,
  label,
  ok,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <div
      className={cn(
        "border bg-background p-3",
        ok ? "border-border" : "border-destructive",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4" aria-hidden />
        <span>{label}</span>
      </div>
      <div
        className={cn(
          "mt-2 text-xs font-bold uppercase",
          ok ? "text-green-700 dark:text-green-400" : "text-destructive",
        )}
      >
        {detail ?? (ok ? "OK" : "CHECK")}
      </div>
    </div>
  );
}

function Empty() {
  const t = useTranslations("admin");
  return (
    <div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
      {t("empty")}
    </div>
  );
}
