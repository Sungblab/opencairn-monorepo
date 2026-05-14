"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { userPlanValues, type UserPlan } from "@opencairn/shared";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bug,
  CheckCircle2,
  CreditCard,
  Database,
  Gift,
  Mail,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
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
  | "billing"
  | "promotions"
  | "reports"
  | "audit"
  | "logs"
  | "readiness"
  | "email"
  | "system";
type ExtendedTabKey = TabKey | "apiLogs" | "llmCosts";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  plan: UserPlan;
  balanceCredits?: number;
  monthlyGrantCredits?: number;
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
    billing?: {
      plans: Record<
        string,
        {
          monthlyPriceKrw: number;
          includedMonthlyCredits: number;
          managedLlm: boolean;
          byokAllowed: boolean;
        }
      >;
      marginMultiplier: string | null;
      usdToKrw: string | null;
      model: string | null;
      embedModel: string | null;
    };
    email: { resendConfigured: boolean; smtpConfigured: boolean };
    storage: { s3Configured: boolean };
    readiness?: {
      email: boolean;
      objectStorage: boolean;
      sentry: boolean;
      googleAnalytics: boolean;
      metaPixel: boolean;
      geminiApi: boolean;
      geminiSpendCap: boolean;
      databaseBackups: boolean;
    };
    featureFlags: Record<string, boolean>;
  };
}

interface AdminAnalytics {
  generatedAt: string;
  window: { days: number; trendDays: number };
  overview: {
    users: { total: number; new30d: number };
    content: { workspaces: number; projects: number; notes: number };
    api: {
      calls30d: number;
      failures30d: number;
      clientErrors30d: number;
      failureRate30d: number;
      p95DurationMs30d: number;
    };
    llm: {
      tokens30d: number;
      cachedTokens30d: number;
      costUsd30d: number;
      costKrw30d: number;
    };
  };
  breakdowns: {
    userPlans: Array<{ label: string; value: number; percent: number }>;
    workspacePlans: Array<{ label: string; value: number; percent: number }>;
    agentActionStatuses: Array<{ label: string; value: number; percent: number }>;
    agentActionKinds30d: Array<{ label: string; value: number; percent: number }>;
    usageActions: Array<{ label: string; value: number; percent: number }>;
  };
  operations: {
    health: {
      failedJobs: number;
      failedImports: number;
      failedAgentActions: number;
      approvalRequired: number;
      openReports: number;
    };
    riskQueue: Array<{
      id: string;
      source: string;
      label: string;
      status: string;
      detail: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  trends: {
    apiCallsDaily: Array<{
      date: string;
      total: number;
      failures: number;
      avgDurationMs: number;
    }>;
    llmCostDaily: Array<{
      date: string;
      tokens: number;
      costUsd: number;
      costKrw: number;
    }>;
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

interface AdminBillingSummary {
  planRevenue: {
    estimatedMrrKrw: number;
    plans: Array<{
      plan: string;
      users: number;
      monthlyPriceKrw: number;
      estimatedMrrKrw: number;
      includedMonthlyCredits: number;
    }>;
  };
  creditSummary: {
    totalBalanceCredits: number;
    zeroBalanceUsers: number;
    lowBalanceUsers: number;
    autoRechargeUsers: number;
  };
  creditByPlan: Array<{
    plan: string;
    users: number;
    balanceCredits: number;
    monthlyGrantCredits: number;
  }>;
  lowCreditUsers: Array<{
    id: string;
    email: string;
    name: string;
    plan: UserPlan;
    balanceCredits: number;
    monthlyGrantCredits: number;
  }>;
  recentLedger: Array<{
    id: string;
    userId: string;
    userEmail: string | null;
    kind: string;
    billingPath: string;
    deltaCredits: number;
    balanceAfterCredits: number;
    sourceType: string | null;
    sourceId: string | null;
    createdAt: string;
  }>;
  usage30d: {
    chargedCredits: number;
    grantedCredits: number;
    manualGrantCredits: number;
    subscriptionGrantCredits: number;
    rawCostUsd: number;
    rawCostKrw: number;
    tokensIn: number;
    tokensOut: number;
    grossMarginKrw: number;
  };
  apiHealth30d: {
    total: number;
    failed: number;
    clientErrors: number;
    avgDurationMs: number;
  };
}

interface CreditCampaign {
  id: string;
  name: string;
  code: string | null;
  status: "active" | "paused" | "archived";
  creditAmount: number;
  targetPlan: UserPlan | null;
  maxRedemptions: number | null;
  redeemedCount: number;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
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
  { key: "billing", icon: ReceiptText },
  { key: "promotions", icon: Gift },
  { key: "reports", icon: Bug },
  { key: "audit", icon: Shield },
  { key: "logs", icon: Database },
  { key: "apiLogs", icon: ReceiptText },
  { key: "llmCosts", icon: Activity },
  { key: "readiness", icon: ShieldCheck },
  { key: "email", icon: Mail },
  { key: "system", icon: Settings },
];
const hostedOnlyTabs = new Set<ExtendedTabKey>([
  "billing",
  "promotions",
  "readiness",
]);

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

function formatCompact(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined).format(value);
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
  detail,
  critical,
}: {
  label: string;
  value: number;
  detail?: string;
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
        {formatCompact(value)}
      </div>
      {detail ? (
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      ) : null}
    </div>
  );
}

export function AdminUsersClient({
  returnHref = "/dashboard",
  hostedService = true,
}: {
  returnHref?: string;
  hostedService?: boolean;
}) {
  const t = useTranslations("admin");
  const visibleTabs = useMemo(
    () =>
      hostedService
        ? tabs
        : tabs.filter((tab) => !hostedOnlyTabs.has(tab.key)),
    [hostedService],
  );
  const [activeTab, setActiveTab] = useState<ExtendedTabKey>("dashboard");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [subscriptionUsers, setSubscriptionUsers] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspaceSubscription[]>(
    [],
  );
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [auditEvents, setAuditEvents] = useState<AdminAuditEvent[]>([]);
  const [apiLogs, setApiLogs] = useState<ApiRequestLog[]>([]);
  const [llmUsage, setLlmUsage] = useState<LlmUsageSummary | null>(null);
  const [billing, setBilling] = useState<AdminBillingSummary | null>(null);
  const [creditCampaigns, setCreditCampaigns] = useState<CreditCampaign[]>([]);
  const [auditNextOffset, setAuditNextOffset] = useState<number | null>(0);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pages, setPages] = useState<Record<string, number>>({});
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [bulkUserPlan, setBulkUserPlan] = useState<AdminUser["plan"]>("pro");
  const [bulkWorkspacePlan, setBulkWorkspacePlan] =
    useState<AdminWorkspaceSubscription["planType"]>("pro");
  const [subscriptionQuery, setSubscriptionQuery] = useState("");
  const [subscriptionUserPlanFilter, setSubscriptionUserPlanFilter] =
    useState<AdminUser["plan"] | "all">("all");
  const [workspacePlanFilter, setWorkspacePlanFilter] =
    useState<AdminWorkspaceSubscription["planType"] | "all">("all");
  const [creditGrantAmount, setCreditGrantAmount] = useState(8000);
  const [creditGrantReason, setCreditGrantReason] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [campaignCode, setCampaignCode] = useState("");
  const [campaignCreditAmount, setCampaignCreditAmount] = useState(2500);
  const [campaignTargetPlan, setCampaignTargetPlan] =
    useState<AdminUser["plan"] | "all">("all");
  const [campaignMaxRedemptions, setCampaignMaxRedemptions] = useState("");
  const [bulkReportStatus, setBulkReportStatus] =
    useState<AdminReport["status"]>("triaged");
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

  async function loadAnalytics() {
    const body = await fetchJson<AdminAnalytics>("/api/admin/analytics");
    if (!body) return false;
    setAnalytics(body);
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

  async function loadBilling() {
    const body = await fetchJson<AdminBillingSummary>("/api/admin/billing");
    if (!body) return false;
    setBilling(body);
    return true;
  }

  async function loadCreditCampaigns() {
    const body = await fetchJson<{ campaigns: CreditCampaign[] }>(
      "/api/admin/credit-campaigns",
    );
    if (!body) return false;
    setCreditCampaigns(body.campaigns);
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
      if (!hostedService && hostedOnlyTabs.has(activeTab)) {
        setActiveTab("dashboard");
        return;
      }
      if (activeTab === "dashboard" && !overview) {
        ok = await loadOverview();
      }
      if (activeTab === "analytics" && !analytics) {
        ok = await loadAnalytics();
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
      if (hostedService && activeTab === "billing" && !billing) {
        ok = await loadBilling();
      }
      if (hostedService && activeTab === "promotions") {
        const needsSubscriptions =
          subscriptionUsers.length === 0 && workspaces.length === 0;
        const results = await Promise.all([
          creditCampaigns.length === 0 ? loadCreditCampaigns() : true,
          needsSubscriptions ? loadSubscriptions() : true,
        ]);
        ok = results.every(Boolean);
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
  }, [activeTab, hostedService]);

  useEffect(() => {
    setPageFor("users", 0);
  }, [query]);

  useEffect(() => {
    setPageFor("subscriptionUsers", 0);
    setPageFor("workspaces", 0);
  }, [subscriptionQuery, subscriptionUserPlanFilter, workspacePlanFilter]);

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter((user) =>
      `${user.name} ${user.email} ${user.plan}`.toLowerCase().includes(needle),
    );
  }, [query, users]);

  const filteredSubscriptionUsers = useMemo(() => {
    const needle = subscriptionQuery.trim().toLowerCase();
    return subscriptionUsers.filter((user) => {
      const matchesPlan =
        subscriptionUserPlanFilter === "all" ||
        user.plan === subscriptionUserPlanFilter;
      const matchesQuery =
        !needle ||
        `${user.name} ${user.email} ${user.plan}`.toLowerCase().includes(needle);
      return matchesPlan && matchesQuery;
    });
  }, [subscriptionQuery, subscriptionUserPlanFilter, subscriptionUsers]);

  const filteredWorkspaces = useMemo(() => {
    const needle = subscriptionQuery.trim().toLowerCase();
    return workspaces.filter((workspace) => {
      const matchesPlan =
        workspacePlanFilter === "all" || workspace.planType === workspacePlanFilter;
      const matchesQuery =
        !needle ||
        `${workspace.name} ${workspace.slug} ${workspace.planType}`
          .toLowerCase()
          .includes(needle);
      return matchesPlan && matchesQuery;
    });
  }, [subscriptionQuery, workspacePlanFilter, workspaces]);

  useEffect(() => {
    const visibleUserIds = new Set(filteredUsers.map((user) => user.id));
    setSelectedUserIds((current) =>
      current.filter((id) => visibleUserIds.has(id)),
    );
  }, [filteredUsers]);

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
    filteredSubscriptionUsers,
    pageFor("subscriptionUsers"),
    pageSize,
  );
  const pagedWorkspaces = slicePage(
    filteredWorkspaces,
    pageFor("workspaces"),
    pageSize,
  );
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
  const selectedUserCount = selectedUserIds.length;
  const selectedUserIdSet = useMemo(
    () => new Set(selectedUserIds),
    [selectedUserIds],
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

  async function post(
    path: string,
    body: unknown,
    refresh: () => Promise<unknown>,
  ) {
    setBusy(path);
    setError(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      setError(t("errors.update"));
      return false;
    }
    await refresh();
    return true;
  }

  function toggleUserSelection(userId: string) {
    setSelectedUserIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    );
  }

  function toggleVisibleUserSelection() {
    const visibleIds = filteredUsers.map((user) => user.id);
    const allVisibleSelected = visibleIds.every((id) =>
      selectedUserIdSet.has(id),
    );
    setSelectedUserIds((current) =>
      allVisibleSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : Array.from(new Set([...current, ...visibleIds])),
    );
  }

  async function bulkPatch(
    path: string,
    body: unknown,
    refresh: () => Promise<unknown>,
  ) {
    const ok = await patch(path, body, refresh);
    if (ok && path.includes("/users/site-admin")) {
      setSelectedUserIds([]);
    }
    return ok;
  }

  async function createCreditCampaign() {
    const ok = await post(
      "/api/admin/credit-campaigns",
      {
        name: campaignName,
        code: campaignCode || undefined,
        creditAmount: campaignCreditAmount,
        targetPlan:
          campaignTargetPlan === "all" ? null : campaignTargetPlan,
        maxRedemptions: campaignMaxRedemptions
          ? Number(campaignMaxRedemptions)
          : null,
      },
      async () => {
        await Promise.all([loadCreditCampaigns(), loadBilling()]);
      },
    );
    if (ok) {
      setCampaignName("");
      setCampaignCode("");
      setCampaignMaxRedemptions("");
    }
  }

  const stats = overview?.stats ?? {};
  const hasOverview = overview !== null;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border border-border bg-card lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
        <div className="border-b border-border p-2">
          <a
            href={returnHref}
            className="flex h-9 items-center gap-2 border border-border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t("actions.backToApp")}
          </a>
        </div>
        <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("navigation")}
        </div>
        <nav className="grid p-2">
          {visibleTabs.map(({ key, icon: Icon }) => (
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
          hasOverview ? (
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
                  detail={formatNumber(stats.usageThisMonth ?? 0)}
                />
                <StatBox
                  label={t("stats.apiCallsToday")}
                  value={stats.apiCallsToday ?? 0}
                  detail={t("stats.apiCalls30d", {
                    count: formatCompact(stats.apiCalls30d ?? 0),
                  })}
                />
                <StatBox
                  label={t("stats.mau30d")}
                  value={stats.mau30d ?? 0}
                  detail={t("stats.newUsers30d", {
                    count: formatCompact(stats.newUsers30d ?? 0),
                  })}
                />
                <StatBox
                  label={t("stats.llmCostKrw30d")}
                  value={Math.round(stats.llmCostKrw30d ?? 0)}
                  detail={formatKrw(Math.round(stats.llmCostKrw30d ?? 0))}
                />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title={t("sections.reports")}>
                  <CompactReportList reports={overview.recentReports} />
                </Panel>
                <Panel title={t("sections.operations")}>
                  <OperationList
                    operations={overview.recentOperations.slice(0, 8)}
                  />
                </Panel>
              </div>
            </>
          ) : (
            <Panel title={t("tabs.dashboard")}>
              <Empty />
            </Panel>
          )
        )}

        {activeTab === "analytics" && (
          analytics ? (
            <div className="space-y-4">
              <Panel
                title={t("analytics.sections.commandCenter")}
                action={
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatDate(analytics.generatedAt)}
                  </span>
                }
              >
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <StatBox
                    label={t("analytics.metrics.totalUsers")}
                    value={analytics.overview.users.total}
                    detail={t("analytics.details.newUsers30d", {
                      count: formatNumber(analytics.overview.users.new30d),
                    })}
                  />
                  <StatBox
                    label={t("analytics.metrics.content")}
                    value={analytics.overview.content.notes}
                    detail={t("analytics.details.content", {
                      workspaces: formatNumber(
                        analytics.overview.content.workspaces,
                      ),
                      projects: formatNumber(
                        analytics.overview.content.projects,
                      ),
                    })}
                  />
                  <StatBox
                    label={t("analytics.metrics.apiCalls30d")}
                    value={analytics.overview.api.calls30d}
                    detail={t("analytics.details.p95", {
                      ms: formatNumber(analytics.overview.api.p95DurationMs30d),
                    })}
                    critical={analytics.overview.api.failures30d > 0}
                  />
                  <StatBox
                    label={t("analytics.metrics.llmCost30d")}
                    value={Math.round(analytics.overview.llm.costKrw30d)}
                    detail={`${formatKrw(
                      Math.round(analytics.overview.llm.costKrw30d),
                    )} · ${formatCompact(analytics.overview.llm.tokens30d)}`}
                  />
                  <StatBox
                    label={t("analytics.metrics.apiFailureRate")}
                    value={Math.round(analytics.overview.api.failureRate30d)}
                    detail={t("analytics.details.apiFailures", {
                      failures: formatNumber(analytics.overview.api.failures30d),
                      clientErrors: formatNumber(
                        analytics.overview.api.clientErrors30d,
                      ),
                    })}
                    critical={analytics.overview.api.failures30d > 0}
                  />
                  <StatBox
                    label={t("analytics.metrics.pendingApprovals")}
                    value={analytics.operations.health.approvalRequired}
                    detail={t("analytics.details.failedActions", {
                      count: formatNumber(
                        analytics.operations.health.failedAgentActions,
                      ),
                    })}
                    critical={
                      analytics.operations.health.approvalRequired > 0 ||
                      analytics.operations.health.failedAgentActions > 0
                    }
                  />
                  <StatBox
                    label={t("analytics.metrics.failedJobs")}
                    value={analytics.operations.health.failedJobs}
                    detail={t("analytics.details.failedImports", {
                      count: formatNumber(
                        analytics.operations.health.failedImports,
                      ),
                    })}
                    critical={
                      analytics.operations.health.failedJobs > 0 ||
                      analytics.operations.health.failedImports > 0
                    }
                  />
                  <StatBox
                    label={t("analytics.metrics.openReports")}
                    value={analytics.operations.health.openReports}
                    critical={analytics.operations.health.openReports > 0}
                  />
                </div>
              </Panel>

              <div className="grid gap-4 xl:grid-cols-2">
                <TrendPanel
                  title={t("analytics.sections.apiTrend")}
                  rows={analytics.trends.apiCallsDaily}
                  valueKey="total"
                  secondaryKey="failures"
                  secondaryLabel={t("analytics.labels.failures")}
                  formatter={formatNumber}
                />
                <TrendPanel
                  title={t("analytics.sections.llmTrend")}
                  rows={analytics.trends.llmCostDaily}
                  valueKey="costKrw"
                  secondaryKey="tokens"
                  secondaryLabel={t("analytics.labels.tokens")}
                  formatter={(value) => formatKrw(Math.round(value))}
                />
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <AnalyticsBreakdownPanel
                  title={t("sections.userPlans")}
                  rows={analytics.breakdowns.userPlans}
                />
                <AnalyticsBreakdownPanel
                  title={t("sections.workspacePlans")}
                  rows={analytics.breakdowns.workspacePlans}
                />
                <AnalyticsBreakdownPanel
                  title={t("sections.actionStatuses")}
                  rows={analytics.breakdowns.agentActionStatuses}
                />
                <AnalyticsBreakdownPanel
                  title={t("analytics.sections.actionKinds")}
                  rows={analytics.breakdowns.agentActionKinds30d}
                />
                <AnalyticsBreakdownPanel
                  title={t("sections.usage")}
                  rows={analytics.breakdowns.usageActions}
                />
                <RiskQueuePanel rows={analytics.operations.riskQueue} />
              </div>
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
            <div className="mb-3 flex flex-wrap items-center gap-2 border border-border bg-muted/30 p-2">
              <span className="text-xs font-semibold uppercase text-muted-foreground">
                {t("bulk.selected", { count: selectedUserCount })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null || selectedUserCount === 0}
                onClick={() =>
                  void bulkPatch(
                    "/api/admin/users/site-admin",
                    { userIds: selectedUserIds, isSiteAdmin: true },
                    async () => {
                      await Promise.all([loadUsers(), loadOverview()]);
                    },
                  )
                }
              >
                {t("bulk.grantSiteAdmin")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null || selectedUserCount === 0}
                onClick={() =>
                  void bulkPatch(
                    "/api/admin/users/site-admin",
                    { userIds: selectedUserIds, isSiteAdmin: false },
                    async () => {
                      await Promise.all([loadUsers(), loadOverview()]);
                    },
                  )
                }
              >
                {t("bulk.revokeSiteAdmin")}
              </Button>
            </div>
            <ScrollBox>
              <table className="min-w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                    <th className="w-10 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={t("bulk.selectVisible")}
                        checked={
                          filteredUsers.length > 0 &&
                          filteredUsers.every((user) =>
                            selectedUserIdSet.has(user.id),
                          )
                        }
                        onChange={toggleVisibleUserSelection}
                        className="h-4 w-4"
                      />
                    </th>
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
                        <input
                          type="checkbox"
                          aria-label={t("bulk.selectRow")}
                          checked={selectedUserIdSet.has(user.id)}
                          onChange={() => toggleUserSelection(user.id)}
                          className="h-4 w-4"
                        />
                      </td>
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
          <div className="space-y-4">
            <Panel title={t("bulk.title")}>
              <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr_1fr]">
                <div className="grid gap-2 sm:grid-cols-[1fr_140px_160px]">
                  <label className="sr-only" htmlFor="subscription-query">
                    {t("filters.subscriptionSearch")}
                  </label>
                  <Input
                    id="subscription-query"
                    value={subscriptionQuery}
                    onChange={(event) => setSubscriptionQuery(event.target.value)}
                    placeholder={t("filters.subscriptionSearch")}
                    className="h-9 rounded-none"
                  />
                  <label className="sr-only" htmlFor="subscription-user-plan-filter">
                    {t("filters.userPlan")}
                  </label>
                  <select
                    id="subscription-user-plan-filter"
                    aria-label={t("filters.userPlan")}
                    value={subscriptionUserPlanFilter}
                    onChange={(event) =>
                      setSubscriptionUserPlanFilter(
                        event.target.value as AdminUser["plan"] | "all",
                      )
                    }
                    className="h-9 border border-border bg-background px-2 text-sm font-semibold uppercase"
                  >
                    <option value="all">{t("filters.allUserPlans")}</option>
                    {userPlanValues.map((plan) => (
                      <option key={plan} value={plan}>
                        {plan}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor="workspace-plan-filter">
                    {t("filters.workspacePlan")}
                  </label>
                  <select
                    id="workspace-plan-filter"
                    aria-label={t("filters.workspacePlan")}
                    value={workspacePlanFilter}
                    onChange={(event) =>
                      setWorkspacePlanFilter(
                        event.target.value as
                          | AdminWorkspaceSubscription["planType"]
                          | "all",
                      )
                    }
                    className="h-9 border border-border bg-background px-2 text-sm font-semibold uppercase"
                  >
                    <option value="all">{t("filters.allWorkspacePlans")}</option>
                    {(["free", "pro", "enterprise"] as const).map((plan) => (
                      <option key={plan} value={plan}>
                        {plan}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="bulk-user-plan"
                    className="text-xs font-semibold uppercase text-muted-foreground"
                  >
                    {t("bulk.userPlan")}
                  </label>
                  <select
                    id="bulk-user-plan"
                    value={bulkUserPlan}
                    onChange={(event) =>
                      setBulkUserPlan(event.target.value as AdminUser["plan"])
                    }
                    className="h-9 border border-border bg-background px-2 text-sm font-semibold uppercase"
                  >
                    {userPlanValues.map((plan) => (
                      <option key={plan} value={plan}>
                        {plan}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      busy !== null || filteredSubscriptionUsers.length === 0
                    }
                    onClick={() =>
                      void bulkPatch(
                        "/api/admin/users/plan",
                        {
                          userIds: filteredSubscriptionUsers.map(
                            (user) => user.id,
                          ),
                          plan: bulkUserPlan,
                        },
                        async () => {
                          await Promise.all([
                            loadSubscriptions(),
                            loadOverview(),
                          ]);
                        },
                      )
                    }
                  >
                    {t("bulk.applyUserPlan")}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label
                    htmlFor="bulk-workspace-plan"
                    className="text-xs font-semibold uppercase text-muted-foreground"
                  >
                    {t("bulk.workspacePlan")}
                  </label>
                  <select
                    id="bulk-workspace-plan"
                    value={bulkWorkspacePlan}
                    onChange={(event) =>
                      setBulkWorkspacePlan(
                        event.target
                          .value as AdminWorkspaceSubscription["planType"],
                      )
                    }
                    className="h-9 border border-border bg-background px-2 text-sm font-semibold uppercase"
                  >
                    {(["free", "pro", "enterprise"] as const).map((plan) => (
                      <option key={plan} value={plan}>
                        {plan}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy !== null || filteredWorkspaces.length === 0}
                    onClick={() =>
                      void bulkPatch(
                        "/api/admin/workspaces/plan",
                        {
                          workspaceIds: filteredWorkspaces.map(
                            (workspace) => workspace.id,
                          ),
                          planType: bulkWorkspacePlan,
                        },
                        async () => {
                          await Promise.all([
                            loadSubscriptions(),
                            loadOverview(),
                          ]);
                        },
                      )
                    }
                  >
                    {t("bulk.applyWorkspacePlan")}
                  </Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <label
                  htmlFor="credit-grant-amount"
                  className="text-xs font-semibold uppercase text-muted-foreground"
                >
                  {t("bulk.creditGrant")}
                </label>
                <Input
                  id="credit-grant-amount"
                  type="number"
                  min={1}
                  max={1000000}
                  value={creditGrantAmount}
                  onChange={(event) =>
                    setCreditGrantAmount(Number(event.target.value))
                  }
                  className="h-9 w-32 rounded-none"
                />
                <Input
                  value={creditGrantReason}
                  onChange={(event) => setCreditGrantReason(event.target.value)}
                  placeholder={t("bulk.creditReason")}
                  className="h-9 max-w-xs rounded-none"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    busy !== null ||
                    filteredSubscriptionUsers.length === 0 ||
                    creditGrantAmount <= 0
                  }
                  onClick={() =>
                    void bulkPatch(
                      "/api/admin/users/credits",
                      {
                        userIds: filteredSubscriptionUsers.map((user) => user.id),
                        credits: creditGrantAmount,
                        reason: creditGrantReason || undefined,
                      },
                      async () => {
                        await Promise.all([loadSubscriptions(), loadOverview()]);
                      },
                    )
                  }
                >
                  {t("bulk.applyCreditGrant", {
                    count: filteredSubscriptionUsers.length,
                  })}
                </Button>
              </div>
            </Panel>
            <div className="grid gap-4 xl:grid-cols-2">
              <PlanTable
                title={t("sections.userSubscriptions")}
                rows={pagedSubscriptionUsers}
                totalRows={filteredSubscriptionUsers.length}
                page={pageFor("subscriptionUsers")}
                pageSize={pageSize}
                onPageChange={(page) => setPageFor("subscriptionUsers", page)}
                onPageSizeChange={handlePageSizeChange}
                idPrefix="user"
                options={[...userPlanValues]}
                getValue={(row) => row.plan}
                getName={(row) => row.name}
                getMeta={(row) => row.email}
                getExtra={(row) =>
                  t("credits.summary", {
                    balance: formatNumber(row.balanceCredits ?? 0),
                    monthly: formatNumber(row.monthlyGrantCredits ?? 0),
                  })
                }
                onChange={(row, plan) =>
                  patch(
                    `/api/admin/users/${row.id}/plan`,
                    { plan },
                    async () => {
                      await Promise.all([loadSubscriptions(), loadOverview()]);
                    },
                  )
                }
                busy={busy !== null}
              />
              <PlanTable
                title={t("sections.workspaceSubscriptions")}
                rows={pagedWorkspaces}
                totalRows={filteredWorkspaces.length}
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
          </div>
        )}

        {activeTab === "billing" && (
          billing ? (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <StatBox
                  label={t("billing.mrr")}
                  value={billing.planRevenue.estimatedMrrKrw}
                  detail={formatKrw(billing.planRevenue.estimatedMrrKrw)}
                />
                <StatBox
                  label={t("billing.totalCredits")}
                  value={billing.creditSummary.totalBalanceCredits}
                  detail={formatNumber(billing.creditSummary.totalBalanceCredits)}
                />
                <StatBox
                  label={t("billing.lowCredits")}
                  value={billing.creditSummary.lowBalanceUsers}
                  critical={billing.creditSummary.lowBalanceUsers > 0}
                />
                <StatBox
                  label={t("billing.grossMargin")}
                  value={Math.round(billing.usage30d.grossMarginKrw)}
                  detail={formatKrw(Math.round(billing.usage30d.grossMarginKrw))}
                  critical={billing.usage30d.grossMarginKrw < 0}
                />
                <StatBox
                  label={t("billing.chargedCredits")}
                  value={billing.usage30d.chargedCredits}
                  detail={formatNumber(billing.usage30d.chargedCredits)}
                />
                <StatBox
                  label={t("billing.grantedCredits")}
                  value={billing.usage30d.grantedCredits}
                  detail={formatNumber(billing.usage30d.grantedCredits)}
                />
                <StatBox
                  label={t("billing.rawCost")}
                  value={Math.round(billing.usage30d.rawCostKrw)}
                  detail={`${formatKrw(Math.round(billing.usage30d.rawCostKrw))} · ${formatUsd(
                    billing.usage30d.rawCostUsd,
                  )}`}
                />
                <StatBox
                  label={t("billing.apiFailure")}
                  value={billing.apiHealth30d.failed}
                  detail={`${formatNumber(billing.apiHealth30d.total)} req · ${billing.apiHealth30d.avgDurationMs}ms`}
                  critical={billing.apiHealth30d.failed > 0}
                />
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title={t("billing.planRevenue")}>
                  <SimpleRows
                    rows={billing.planRevenue.plans.map((row) => ({
                      key: row.plan,
                      left: `${row.plan} · ${row.users}`,
                      right: formatKrw(row.estimatedMrrKrw),
                      sub: `${formatNumber(row.includedMonthlyCredits)} credits`,
                    }))}
                  />
                </Panel>
                <Panel title={t("billing.creditByPlan")}>
                  <SimpleRows
                    rows={billing.creditByPlan.map((row) => ({
                      key: row.plan,
                      left: `${row.plan} · ${row.users}`,
                      right: formatNumber(row.balanceCredits),
                      sub: `${formatNumber(row.monthlyGrantCredits)} monthly`,
                    }))}
                  />
                </Panel>
                <Panel title={t("billing.lowCreditUsers")}>
                  <SimpleRows
                    rows={billing.lowCreditUsers.map((row) => ({
                      key: row.id,
                      left: row.email,
                      right: formatNumber(row.balanceCredits),
                      sub: `${row.plan} · ${formatNumber(row.monthlyGrantCredits)} monthly`,
                    }))}
                  />
                </Panel>
                <Panel title={t("billing.recentLedger")}>
                  <SimpleRows
                    rows={billing.recentLedger.map((row) => ({
                      key: row.id,
                      left: `${row.kind} · ${row.userEmail ?? row.userId}`,
                      right: formatNumber(row.deltaCredits),
                      sub: `${row.sourceType ?? row.billingPath} · ${formatDate(row.createdAt)}`,
                    }))}
                  />
                </Panel>
              </div>
            </div>
          ) : (
            <Panel title={t("tabs.billing")}>
              <Empty />
            </Panel>
          )
        )}

        {activeTab === "promotions" && (
          <div className="space-y-4">
            <Panel title={t("promotions.create")}>
              <div className="grid gap-2 xl:grid-cols-[1fr_140px_140px_140px_140px_auto]">
                <Input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  placeholder={t("promotions.name")}
                  className="h-9 rounded-none"
                />
                <Input
                  value={campaignCode}
                  onChange={(event) => setCampaignCode(event.target.value)}
                  placeholder={t("promotions.code")}
                  className="h-9 rounded-none"
                />
                <Input
                  type="number"
                  min={1}
                  value={campaignCreditAmount}
                  onChange={(event) =>
                    setCampaignCreditAmount(Number(event.target.value))
                  }
                  aria-label={t("promotions.creditAmount")}
                  className="h-9 rounded-none"
                />
                <select
                  value={campaignTargetPlan}
                  onChange={(event) =>
                    setCampaignTargetPlan(
                      event.target.value as AdminUser["plan"] | "all",
                    )
                  }
                  aria-label={t("promotions.targetPlan")}
                  className="h-9 border border-border bg-background px-2 text-sm font-semibold uppercase"
                >
                  <option value="all">{t("filters.allUserPlans")}</option>
                  {userPlanValues.map((plan) => (
                    <option key={plan} value={plan}>
                      {plan}
                    </option>
                  ))}
                </select>
                <Input
                  value={campaignMaxRedemptions}
                  onChange={(event) =>
                    setCampaignMaxRedemptions(event.target.value)
                  }
                  placeholder={t("promotions.maxRedemptions")}
                  className="h-9 rounded-none"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    busy !== null || !campaignName.trim() || campaignCreditAmount <= 0
                  }
                  onClick={() => void createCreditCampaign()}
                >
                  {t("promotions.createAction")}
                </Button>
              </div>
            </Panel>
            <Panel title={t("bulk.title")}>
              <div className="grid gap-2 md:grid-cols-[1fr_160px_auto]">
                <Input
                  value={subscriptionQuery}
                  onChange={(event) => setSubscriptionQuery(event.target.value)}
                  placeholder={t("filters.subscriptionSearch")}
                  className="h-9 rounded-none"
                />
                <select
                  aria-label={t("filters.userPlan")}
                  value={subscriptionUserPlanFilter}
                  onChange={(event) =>
                    setSubscriptionUserPlanFilter(
                      event.target.value as AdminUser["plan"] | "all",
                    )
                  }
                  className="h-9 border border-border bg-background px-2 text-sm font-semibold uppercase"
                >
                  <option value="all">{t("filters.allUserPlans")}</option>
                  {userPlanValues.map((plan) => (
                    <option key={plan} value={plan}>
                      {plan}
                    </option>
                  ))}
                </select>
                <div className="text-sm font-semibold text-muted-foreground">
                  {t("promotions.filteredUsers", {
                    count: filteredSubscriptionUsers.length,
                  })}
                </div>
              </div>
            </Panel>
            <Panel title={t("promotions.active")}>
              <div className="space-y-2">
                {creditCampaigns.length === 0 ? <Empty /> : null}
                {creditCampaigns.map((campaign) => (
                  <div
                    key={campaign.id}
                    className="grid gap-3 border border-border bg-background p-3 xl:grid-cols-[1fr_220px]"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill value={campaign.status} />
                        {campaign.code ? <StatusPill value={campaign.code} /> : null}
                        <span className="text-sm font-semibold">
                          {t("promotions.creditLabel", {
                            credits: formatNumber(campaign.creditAmount),
                          })}
                        </span>
                      </div>
                      <h3 className="mt-2 font-bold">{campaign.name}</h3>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {t("promotions.campaignMeta", {
                          plan: campaign.targetPlan ?? "all",
                          redeemed: campaign.redeemedCount,
                          max: campaign.maxRedemptions ?? "∞",
                        })}
                      </div>
                    </div>
                    <div className="grid content-start gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          busy !== null ||
                          campaign.status !== "active" ||
                          filteredSubscriptionUsers.length === 0
                        }
                        onClick={() =>
                          void post(
                            `/api/admin/credit-campaigns/${campaign.id}/grant`,
                            {
                              userIds: filteredSubscriptionUsers.map(
                                (user) => user.id,
                              ),
                              reason: campaign.code ?? campaign.name,
                            },
                            async () => {
                              await Promise.all([
                                loadCreditCampaigns(),
                                loadBilling(),
                                loadSubscriptions(),
                              ]);
                            },
                          )
                        }
                      >
                        {t("promotions.grantFiltered", {
                          count: filteredSubscriptionUsers.length,
                        })}
                      </Button>
                      {(["active", "paused", "archived"] as const).map((status) => (
                        <Button
                          key={status}
                          type="button"
                          variant={campaign.status === status ? "default" : "outline"}
                          size="sm"
                          disabled={busy !== null || campaign.status === status}
                          onClick={() =>
                            void patch(
                              `/api/admin/credit-campaigns/${campaign.id}`,
                              { status },
                              async () => {
                                await loadCreditCampaigns();
                              },
                            )
                          }
                        >
                          {t(`promotions.status.${status}`)}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        )}

        {activeTab === "reports" && (
          <Panel title={t("sections.reports")}>
            <div className="mb-3 flex flex-wrap items-center gap-2 border border-border bg-muted/30 p-2">
              <label
                htmlFor="bulk-report-status"
                className="text-xs font-semibold uppercase text-muted-foreground"
              >
                {t("bulk.reportStatus")}
              </label>
              <select
                id="bulk-report-status"
                value={bulkReportStatus}
                onChange={(event) =>
                  setBulkReportStatus(
                    event.target.value as AdminReport["status"],
                  )
                }
                className="h-9 border border-border bg-background px-2 text-sm font-semibold uppercase"
              >
                {(["open", "triaged", "resolved", "closed"] as const).map(
                  (status) => (
                    <option key={status} value={status}>
                      {t(`reportStatuses.${status}`)}
                    </option>
                  ),
                )}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null || reports.length === 0}
                onClick={() =>
                  void bulkPatch(
                    "/api/admin/reports/status",
                    {
                      reportIds: reports.map((report) => report.id),
                      status: bulkReportStatus,
                    },
                    async () => {
                      await Promise.all([loadReports(), loadOverview()]);
                    },
                  )
                }
              >
                {t("bulk.applyReportStatus")}
              </Button>
            </div>
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

        {activeTab === "readiness" && (
          overview ? (
            <div className="space-y-4">
              <Panel title={t("sections.readiness")}>
                <ReadinessChecklist readiness={overview.system.readiness} />
              </Panel>
              <Panel title={t("readiness.guidanceTitle")}>
                <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                  <div className="border border-border bg-background p-3">
                    <div className="font-semibold text-foreground">
                      {t("readiness.backendTitle")}
                    </div>
                    <p className="mt-1">{t("readiness.backendBody")}</p>
                  </div>
                  <div className="border border-border bg-background p-3">
                    <div className="font-semibold text-foreground">
                      {t("readiness.privacyTitle")}
                    </div>
                    <p className="mt-1">{t("readiness.privacyBody")}</p>
                  </div>
                </div>
              </Panel>
            </div>
          ) : (
            <Panel title={t("tabs.readiness")}>
              <Empty />
            </Panel>
          )
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
                <ConfigBox
                  icon={CreditCard}
                  label={t("system.margin")}
                  ok={Boolean(overview.system.billing?.marginMultiplier)}
                  detail={overview.system.billing?.marginMultiplier ?? "default"}
                />
                <ConfigBox
                  icon={Activity}
                  label={t("system.llmModel")}
                  ok={Boolean(overview.system.billing?.model)}
                  detail={overview.system.billing?.model ?? "default"}
                />
                {Object.entries(overview.system.billing?.plans ?? {}).map(
                  ([key, plan]) => (
                    <ConfigBox
                      key={key}
                      icon={CreditCard}
                      label={t("system.planConfig", { plan: key })}
                      ok
                      detail={`${formatKrw(plan.monthlyPriceKrw)} · ${formatNumber(
                        plan.includedMonthlyCredits,
                      )} credits`}
                    />
                  ),
                )}
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
                {formatOperationDetail(op.detail)}
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

function SimpleRows({
  rows,
}: {
  rows: Array<{ key: string; left: string; right: string; sub?: string }>;
}) {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border border-border bg-background p-2"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{row.left}</div>
            {row.sub ? (
              <div className="truncate text-xs text-muted-foreground">
                {row.sub}
              </div>
            ) : null}
          </div>
          <div className="text-sm font-bold tabular-nums">{row.right}</div>
        </div>
      ))}
    </div>
  );
}

function ReadinessChecklist({
  readiness,
}: {
  readiness?: NonNullable<AdminOverview["system"]["readiness"]>;
}) {
  const t = useTranslations("admin");
  const rows = [
    "email",
    "objectStorage",
    "sentry",
    "googleAnalytics",
    "metaPixel",
    "geminiApi",
    "geminiSpendCap",
    "databaseBackups",
  ] as const;

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      {rows.map((key) => {
        const ready = readiness?.[key] ?? false;
        return (
          <div
            key={key}
            className={cn(
              "flex items-start gap-3 border bg-background p-3",
              ready ? "border-green-600/70" : "border-destructive/70",
            )}
          >
            {ready ? (
              <CheckCircle2
                className="mt-0.5 h-4 w-4 shrink-0 text-green-700 dark:text-green-400"
                aria-hidden
              />
            ) : (
              <AlertTriangle
                className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                aria-hidden
              />
            )}
            <div className="min-w-0">
              <div className="text-sm font-bold">{t(`readiness.${key}`)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t(`readiness.${key}Description`)}
              </div>
              <div
                className={cn(
                  "mt-2 inline-flex h-6 items-center border px-2 text-xs font-semibold uppercase",
                  ready
                    ? "border-green-600 text-green-700 dark:text-green-400"
                    : "border-destructive text-destructive",
                )}
              >
                {ready ? t("readiness.ready") : t("readiness.needsSetup")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatOperationDetail(detail: string | null) {
  if (!detail) return "-";
  const trimmed = detail.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const code = typeof parsed.code === "string" ? parsed.code : null;
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : typeof parsed.error === "string"
          ? parsed.error
          : null;
    return [code, message].filter(Boolean).join(" · ") || "JSON error";
  } catch {
    return trimmed.slice(0, 80);
  }
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

function AnalyticsBreakdownPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number; percent: number }>;
}) {
  return (
    <Panel title={title}>
      <div className="space-y-3">
        {rows.length === 0 ? (
          <Empty />
        ) : (
          rows.map((row) => (
            <div key={row.label}>
              <div className="mb-1 flex justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-semibold">
                  {row.label}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatNumber(row.value)} · {row.percent}%
                </span>
              </div>
              <div className="h-3 border border-border bg-background">
                <div
                  className="h-full bg-foreground"
                  style={{ width: `${Math.min(100, row.percent)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function TrendPanel<T extends Record<string, string | number>>({
  title,
  rows,
  valueKey,
  secondaryKey,
  secondaryLabel,
  formatter,
}: {
  title: string;
  rows: T[];
  valueKey: keyof T;
  secondaryKey: keyof T;
  secondaryLabel: string;
  formatter: (value: number) => string;
}) {
  const max = rows.reduce(
    (current, row) => Math.max(current, Number(row[valueKey] ?? 0)),
    0,
  );
  return (
    <Panel title={title}>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const value = Number(row[valueKey] ?? 0);
            const width = max > 0 ? Math.max(4, (value / max) * 100) : 0;
            return (
              <div
                key={String(row.date)}
                className="grid grid-cols-[88px_minmax(0,1fr)_92px] items-center gap-2 text-xs"
              >
                <span className="tabular-nums text-muted-foreground">
                  {String(row.date).slice(5)}
                </span>
                <div className="h-6 border border-border bg-background">
                  <div
                    className="h-full bg-foreground"
                    style={{ width: `${width}%` }}
                  />
                </div>
                <span className="text-right tabular-nums">
                  {formatter(value)}
                </span>
                <span className="col-start-2 text-muted-foreground">
                  {secondaryLabel} · {formatNumber(Number(row[secondaryKey] ?? 0))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function RiskQueuePanel({
  rows,
}: {
  rows: AdminAnalytics["operations"]["riskQueue"];
}) {
  const t = useTranslations("admin");
  return (
    <Panel title={t("analytics.sections.riskQueue")}>
      <ScrollBox>
        <div className="space-y-2">
          {rows.length === 0 ? (
            <Empty />
          ) : (
            rows.map((row) => (
              <div
                key={`${row.source}:${row.id}`}
                className="grid gap-2 border border-border bg-background p-2 sm:grid-cols-[1fr_auto]"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-semibold">{row.label}</span>
                    <StatusPill value={row.status} />
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {row.source} · {formatDate(row.updatedAt)}
                  </div>
                  {row.detail ? (
                    <div className="mt-1 truncate text-xs font-medium text-muted-foreground">
                      {row.detail}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollBox>
    </Panel>
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
  getExtra,
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
  getExtra?: (row: T) => string;
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
                    {getExtra ? (
                      <div className="truncate text-xs font-medium text-muted-foreground">
                        {getExtra(row)}
                      </div>
                    ) : null}
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
