"use client";

import { useMemo, useRef, useState, useEffect, type ComponentType } from "react";
import dynamic from "next/dynamic";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Bot,
  Check,
  GitMerge,
  Network,
  RotateCw,
  Search,
  Workflow,
  X,
} from "lucide-react";
import type {
  WorkspaceAtlasEdge,
  WorkspaceAtlasNode,
  WorkspaceAtlasOntologyPredicate,
  WorkspaceAtlasResponse,
} from "@opencairn/shared";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";
import { plan8AgentsApi } from "@/lib/api-client";

const ATLAS_FIT_PADDING = 64;
const ATLAS_DEFAULT_LIMIT = 45;
const ATLAS_SEARCH_LIMIT = 80;
const ATLAS_DISPLAY_NODE_LIMIT = 42;
const ATLAS_DISPLAY_EDGE_LIMIT = 96;
const ATLAS_DISPLAY_COMENTION_LIMIT = 18;

const CytoscapeComponent = dynamic(() => import("react-cytoscapejs"), {
  ssr: false,
});

if (typeof window !== "undefined") {
  cytoscape.use(fcose);
}

type ProjectOption = {
  id: string;
  name: string;
};

type CuratorSuggestion = {
  id: string;
  type: string;
  payload?: Record<string, unknown> | null;
  title?: string | null;
  summary?: string | null;
  createdAt?: string | Date | null;
};

async function fetchWorkspaceAtlas(params: {
  workspaceId: string;
  projectId: string;
  q: string;
}): Promise<WorkspaceAtlasResponse> {
  const queryText = params.q.trim();
  const query = new URLSearchParams({
    limit: String(queryText ? ATLAS_SEARCH_LIMIT : ATLAS_DEFAULT_LIMIT),
  });
  if (params.projectId) query.set("projectId", params.projectId);
  if (queryText) query.set("q", queryText);
  const res = await fetch(
    `/api/workspaces/${params.workspaceId}/ontology-atlas?${query.toString()}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`ontology-atlas ${res.status}`);
  return (await res.json()) as WorkspaceAtlasResponse;
}

async function fetchProjects(workspaceId: string): Promise<ProjectOption[]> {
  const res = await fetch(`/api/workspaces/${workspaceId}/projects`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`projects ${res.status}`);
  return (await res.json()) as ProjectOption[];
}

async function fetchCuratorSuggestions(projectId: string): Promise<CuratorSuggestion[]> {
  const res = await fetch(
    `/api/curator/suggestions?projectId=${encodeURIComponent(projectId)}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error(`curator-suggestions ${res.status}`);
  return (await res.json()) as CuratorSuggestion[];
}

function payloadText(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string {
  const value = payload?.[key];
  return typeof value === "string" ? value : "";
}

function formatCuratorSuggestion(suggestion: CuratorSuggestion): string {
  if (suggestion.summary) return suggestion.summary;
  if (suggestion.title) return suggestion.title;
  const source = payloadText(suggestion.payload, "sourceName");
  const target = payloadText(suggestion.payload, "targetName");
  const relation =
    payloadText(suggestion.payload, "proposedRelationType") ||
    payloadText(suggestion.payload, "relationType");
  const names = [source, target].filter(Boolean).join(" -> ");
  return [names, relation].filter(Boolean).join(" · ") || suggestion.type;
}

async function refreshAtlasEvidence(params: {
  workspaceId: string;
  noteIds: string[];
}): Promise<void> {
  const res = await fetch(
    `/api/workspaces/${params.workspaceId}/ontology-atlas/refresh`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ noteIds: params.noteIds }),
    },
  );
  if (!res.ok) throw new Error(`ontology-atlas-refresh ${res.status}`);
}

function atlasNodeScore(node: WorkspaceAtlasNode): number {
  return (
    (node.bridge ? 10_000 : 0) +
    (node.duplicateCandidate ? 5_000 : 0) +
    (node.layer === "explicit" ? 1_000 : 0) +
    node.projectCount * 250 +
    node.degree * 8 +
    node.mentionCount
  );
}

function atlasEdgeScore(edge: WorkspaceAtlasEdge): number {
  const typeBoost =
    edge.edgeType === "wiki_link"
      ? 1_000
      : edge.edgeType === "project_tree"
        ? 900
        : edge.edgeType === "source_artifact"
          ? 800
          : edge.edgeType === "ai_relation"
            ? 500
            : edge.edgeType === "source_membership"
              ? 120
              : 0;
  return (
    typeBoost +
    (edge.crossProject ? 250 : 0) +
    (edge.layer === "explicit" ? 180 : 0) +
    edge.weight * 10
  );
}

function simplifyAtlasForDisplay(
  data: WorkspaceAtlasResponse,
  searching: boolean,
): WorkspaceAtlasResponse {
  const maxNodes = searching ? ATLAS_SEARCH_LIMIT : ATLAS_DISPLAY_NODE_LIMIT;
  const selectedIds = new Set(
    [...data.nodes]
      .sort((a, b) => atlasNodeScore(b) - atlasNodeScore(a) || a.label.localeCompare(b.label))
      .slice(0, maxNodes)
      .map((node) => node.id),
  );
  const selectedNodes = data.nodes.filter((node) => selectedIds.has(node.id));
  const primaryEdges: WorkspaceAtlasEdge[] = [];
  const displayEdges: WorkspaceAtlasEdge[] = [];
  for (const edge of data.edges) {
    if (!selectedIds.has(edge.sourceId) || !selectedIds.has(edge.targetId)) {
      continue;
    }
    if (edge.edgeType === "co_mention") {
      displayEdges.push(edge);
      continue;
    }
    if (edge.edgeType === "source_membership") {
      displayEdges.push(edge);
      continue;
    }
    primaryEdges.push(edge);
  }
  const sortedPrimary = [...primaryEdges].sort(
    (a, b) => atlasEdgeScore(b) - atlasEdgeScore(a),
  );
  const sortedDisplay = [...displayEdges]
    .sort((a, b) => atlasEdgeScore(b) - atlasEdgeScore(a))
    .slice(0, searching ? ATLAS_DISPLAY_COMENTION_LIMIT * 2 : ATLAS_DISPLAY_COMENTION_LIMIT);
  const edges = [...sortedPrimary, ...sortedDisplay].slice(
    0,
    searching ? ATLAS_DISPLAY_EDGE_LIMIT * 2 : ATLAS_DISPLAY_EDGE_LIMIT,
  );
  return {
    ...data,
    nodes: selectedNodes,
    edges,
    truncated:
      data.truncated ||
      selectedNodes.length < data.nodes.length ||
      edges.length < data.edges.length,
  };
}

function ontologyPredicateLabel(
  t: ReturnType<typeof useTranslations>,
  predicate: WorkspaceAtlasOntologyPredicate,
): string {
  switch (predicate) {
    case "is_a":
      return t("predicates.is_a");
    case "part_of":
      return t("predicates.part_of");
    case "contains":
      return t("predicates.contains");
    case "depends_on":
      return t("predicates.depends_on");
    case "causes":
      return t("predicates.causes");
    case "links_to":
      return t("predicates.links_to");
    case "derived_from":
      return t("predicates.derived_from");
    case "appears_with":
      return t("predicates.appears_with");
    case "near_in_source":
      return t("predicates.near_in_source");
    case "same_as_candidate":
      return t("predicates.same_as_candidate");
    case "is_related_to":
    default:
      return t("predicates.is_related_to");
  }
}

export function WorkspaceAtlasView({ wsSlug }: { wsSlug: string }) {
  const t = useTranslations("workspaceAtlas");
  const workspaceId = useWorkspaceId(wsSlug);
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showExplicit, setShowExplicit] = useState(true);
  const [showAi, setShowAi] = useState(true);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["workspace-atlas-projects", workspaceId],
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    queryFn: () => fetchProjects(workspaceId as string),
  });

  const atlasQuery = useQuery({
    queryKey: ["workspace-atlas", workspaceId, projectId, q],
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    queryFn: () =>
      fetchWorkspaceAtlas({
        workspaceId: workspaceId as string,
        projectId,
        q,
      }),
  });
  const curatorSuggestionsQuery = useQuery({
    queryKey: ["workspace-atlas-curator-suggestions", projectId],
    enabled: Boolean(projectId),
    staleTime: 20_000,
    queryFn: () => fetchCuratorSuggestions(projectId),
  });
  const refreshMutation = useMutation({
    mutationFn: (noteIds: string[]) =>
      refreshAtlasEvidence({
        workspaceId: workspaceId as string,
        noteIds,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-atlas", workspaceId],
      });
    },
  });
  const curatorMutation = useMutation({
    mutationFn: () => plan8AgentsApi.runCurator({ projectId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-atlas-curator-suggestions", projectId],
      });
    },
  });
  const resolveSuggestionMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "accepted" | "rejected";
    }) => plan8AgentsApi.resolveSuggestion(id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["workspace-atlas-curator-suggestions", projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["workspace-atlas", workspaceId],
      });
    },
  });

  const data = atlasQuery.data;
  const displayData = useMemo(
    () => (data ? simplifyAtlasForDisplay(data, Boolean(q.trim())) : null),
    [data, q],
  );
  const selectedNode = useMemo(
    () => displayData?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [displayData?.nodes, selectedNodeId],
  );

  const elements = useMemo(() => {
    if (!displayData) return [];
    const visibleNodes = displayData.nodes.filter((node) => {
      if (node.layer === "explicit") return showExplicit;
      if (node.layer === "ai") return showAi;
      return showExplicit || showAi;
    });
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = displayData.edges.filter((edge) => {
      if (!visibleNodeIds.has(edge.sourceId) || !visibleNodeIds.has(edge.targetId)) {
        return false;
      }
      if (edge.layer === "explicit") return showExplicit;
      if (edge.layer === "ai") return showAi;
      return showExplicit || showAi;
    });
    return [
      ...visibleNodes.map((node) => ({
        data: {
          id: node.id,
          label: node.label,
          objectType: node.objectType,
          ontologyClass: node.ontologyClass,
          layer: node.layer,
          projectCount: node.projectCount,
          mentionCount: node.mentionCount,
          bridge: node.bridge,
          duplicateCandidate: node.duplicateCandidate,
          unclassified: node.unclassified,
          stale: node.stale,
        },
      })),
      ...visibleEdges.map((edge) => ({
        data: {
          id: edge.id,
          source: edge.sourceId,
          target: edge.targetId,
          label: ontologyPredicateLabel(t, edge.ontologyPredicate),
          edgeType: edge.edgeType,
          ontologyPredicate: edge.ontologyPredicate,
          inferred: edge.inferred,
          ontologyValid: edge.ontologyValid,
          layer: edge.layer,
          weight: edge.weight,
          crossProject: edge.crossProject,
          stale: edge.stale,
        },
      })),
    ];
  }, [displayData, showAi, showExplicit, t]);

  useEffect(() => {
    if (
      selectedNodeId &&
      displayData &&
      !displayData.nodes.some((node) => node.id === selectedNodeId)
    ) {
      setSelectedNodeId(null);
    }
  }, [displayData, selectedNodeId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const onTap = (evt: cytoscape.EventObject) => {
      if (evt.target === cy) {
        setSelectedNodeId(null);
        return;
      }
      const target = evt.target;
      if (target?.isNode?.()) {
        setSelectedNodeId(target.id());
      }
    };
    cy.on("tap", onTap);
    return () => {
      cy.off("tap", onTap);
    };
  }, [displayData]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || elements.length === 0) return;
    const fit = () => {
      cy.fit(undefined, ATLAS_FIT_PADDING);
    };
    fit();
    cy.on("layoutstop", fit);
    return () => {
      cy.off("layoutstop", fit);
    };
  }, [elements]);

  const stats = useMemo(() => {
    const nodes = displayData?.nodes ?? [];
    return {
      concepts: nodes.filter((node) => node.objectType === "concept").length,
      bridges: nodes.filter((node) => node.bridge).length,
      duplicates: nodes.filter((node) => node.duplicateCandidate).length,
      relations: displayData?.edges.length ?? 0,
      violations: displayData?.edges.filter((edge) => edge.ontologyValid === false).length ?? 0,
    };
  }, [displayData]);

  const predicateStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of displayData?.edges ?? []) {
      counts.set(edge.ontologyPredicate, (counts.get(edge.ontologyPredicate) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 7);
  }, [displayData]);

  const agentSignals = useMemo(() => {
    const edges = displayData?.edges ?? [];
    const ontology = displayData?.ontology;
    return {
      pendingSuggestions: curatorSuggestionsQuery.data?.length ?? 0,
      violations: ontology?.violations.length ?? stats.violations,
      inferredTriples:
        ontology?.triples.filter((triple) => triple.inferred).length ?? 0,
      broadRelations: edges.filter(
        (edge) => edge.ontologyPredicate === "is_related_to",
      ).length,
      duplicates: stats.duplicates,
      staleNodes: displayData?.nodes.filter((node) => node.stale).length ?? 0,
    };
  }, [
    curatorSuggestionsQuery.data?.length,
    displayData?.edges,
    displayData?.nodes,
    displayData?.ontology,
    stats.duplicates,
    stats.violations,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {t("eyebrow")}
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-normal">
              {t("title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("description")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label={t("stats.concepts")} value={stats.concepts} />
            <Stat label={t("stats.bridges")} value={stats.bridges} />
            <Stat label={t("stats.duplicates")} value={stats.duplicates} />
            <Stat label={t("stats.relations")} value={stats.relations} />
            <Stat label={t("stats.violations")} value={stats.violations} />
          </div>
        </div>
      </header>

      <div
        data-testid="workspace-atlas-body"
        className="flex min-h-0 flex-1 overflow-hidden"
      >
        <aside className="flex w-[240px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-border p-4">
          <label className="grid gap-1.5 text-xs font-medium">
            {t("filters.allProjects")}
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="h-9 rounded-[var(--radius-control)] border border-border bg-background px-2 text-sm font-normal"
            >
              <option value="">{t("filters.allProjects")}</option>
              {(projectsQuery.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {t("filters.search")}
            <span className="flex h-9 items-center gap-2 rounded-[var(--radius-control)] border border-border px-2">
              <Search aria-hidden className="h-4 w-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder={t("filters.searchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-sm font-normal outline-none placeholder:text-muted-foreground"
              />
            </span>
          </label>
          <div className="space-y-2 text-xs">
            <Legend icon={Workflow} label={t("legend.bridge")} />
            <Legend icon={GitMerge} label={t("legend.duplicate")} />
            <Legend icon={Network} label={t("legend.unclassified")} />
            <Legend icon={Network} label={t("legend.stale")} />
          </div>
          {predicateStats.length > 0 ? (
            <div className="space-y-2 rounded-[var(--radius-control)] border border-border p-3">
              <p className="text-xs font-semibold">{t("ontology.predicates")}</p>
              <div className="space-y-1.5 text-xs">
                {predicateStats.map(([predicate, count]) => (
                  <div
                    key={predicate}
                    className="flex items-center justify-between gap-3 text-muted-foreground"
                  >
                    <span className="truncate">
                      {ontologyPredicateLabel(
                        t,
                        predicate as WorkspaceAtlasOntologyPredicate,
                      )}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-3 rounded-[var(--radius-control)] border border-border p-3">
            <div className="flex items-center gap-2">
              <Bot aria-hidden className="h-4 w-4 text-muted-foreground" />
              <p className="text-xs font-semibold">{t("agents.title")}</p>
            </div>
            <div className="grid gap-1.5 text-xs text-muted-foreground">
              <AgentSignal label={t("agents.pending")} value={agentSignals.pendingSuggestions} />
              <AgentSignal label={t("agents.violations")} value={agentSignals.violations} />
              <AgentSignal label={t("agents.broadRelations")} value={agentSignals.broadRelations} />
              <AgentSignal label={t("agents.inferred")} value={agentSignals.inferredTriples} />
              <AgentSignal label={t("agents.stale")} value={agentSignals.staleNodes} />
            </div>
            <button
              type="button"
              disabled={!projectId || curatorMutation.isPending}
              onClick={() => curatorMutation.mutate()}
              className="h-8 w-full rounded-[var(--radius-control)] border border-border px-2 text-left text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {curatorMutation.isPending
                ? t("agents.runningCurator")
                : projectId
                  ? t("agents.runCurator")
                  : t("agents.selectProject")}
            </button>
            {(curatorSuggestionsQuery.data?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {curatorSuggestionsQuery.data?.slice(0, 3).map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="rounded-[var(--radius-control)] border border-border bg-muted/30 p-2"
                  >
                    <p className="truncate text-xs font-medium">
                      {t(`agents.suggestionTypes.${suggestion.type}`)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {formatCuratorSuggestion(suggestion)}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        aria-label={t("agents.acceptSuggestion")}
                        disabled={resolveSuggestionMutation.isPending}
                        onClick={() =>
                          resolveSuggestionMutation.mutate({
                            id: suggestion.id,
                            status: "accepted",
                          })
                        }
                        className="grid h-7 flex-1 place-items-center rounded-[var(--radius-control)] border border-border bg-background disabled:opacity-50"
                      >
                        <Check aria-hidden className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("agents.rejectSuggestion")}
                        disabled={resolveSuggestionMutation.isPending}
                        onClick={() =>
                          resolveSuggestionMutation.mutate({
                            id: suggestion.id,
                            status: "rejected",
                          })
                        }
                        className="grid h-7 flex-1 place-items-center rounded-[var(--radius-control)] border border-border bg-background disabled:opacity-50"
                      >
                        <X aria-hidden className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid gap-2 text-xs font-medium">
            <button
              type="button"
              aria-pressed={showExplicit}
              onClick={() => setShowExplicit((value) => !value)}
              className="h-8 rounded-[var(--radius-control)] border border-border px-2 text-left data-[active=true]:border-primary data-[active=true]:bg-primary/10"
              data-active={showExplicit}
            >
              {t("layers.explicit")}
            </button>
            <button
              type="button"
              aria-pressed={showAi}
              onClick={() => setShowAi((value) => !value)}
              className="h-8 rounded-[var(--radius-control)] border border-border px-2 text-left data-[active=true]:border-primary data-[active=true]:bg-primary/10"
              data-active={showAi}
            >
              {t("layers.ai")}
            </button>
          </div>
        </aside>

        <main className="relative min-w-0 flex-1 overflow-hidden">
          {atlasQuery.isLoading || !workspaceId ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              {t("loading")}
            </div>
          ) : atlasQuery.error ? (
            <div className="grid h-full place-items-center text-sm text-destructive">
              {t("error")}
            </div>
          ) : !displayData || displayData.nodes.length === 0 ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              {t("empty")}
            </div>
          ) : (
            <CytoscapeComponent
              elements={elements as cytoscape.ElementDefinition[]}
              layout={{
                name: "fcose",
                animate: true,
                randomize: false,
                padding: 48,
                nodeRepulsion: 9000,
                idealEdgeLength: 150,
                gravity: 0.18,
              } as cytoscape.LayoutOptions}
              stylesheet={ATLAS_STYLESHEET as cytoscape.StylesheetJsonBlock[]}
              cy={(cy: cytoscape.Core) => {
                cyRef.current = cy;
              }}
              style={{ width: "100%", height: "100%" }}
            />
          )}
          <AtlasDetail
            node={selectedNode}
            onRefresh={(noteIds) => refreshMutation.mutate(noteIds)}
            refreshPending={refreshMutation.isPending}
          />
        </main>
      </div>
    </div>
  );
}

function AgentSignal({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="truncate">{label}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-20 rounded-[var(--radius-control)] border border-border px-3 py-2 text-right">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Legend({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <Icon aria-hidden className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  );
}

function AtlasDetail({
  node,
  onRefresh,
  refreshPending,
}: {
  node: WorkspaceAtlasNode | null;
  onRefresh: (noteIds: string[]) => void;
  refreshPending: boolean;
}) {
  const t = useTranslations("workspaceAtlas.detail");
  if (!node) {
    return (
      <aside
        data-testid="workspace-atlas-detail-panel"
        className="absolute right-3 top-3 z-10 w-[320px] max-w-[calc(100%-1.5rem)] rounded-[var(--radius-control)] border border-dashed border-border bg-background/95 p-4 shadow-sm"
      >
        <div className="rounded-[var(--radius-control)] border border-dashed border-border p-4">
          <h2 className="text-sm font-medium">{t("placeholderTitle")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("placeholderBody")}
          </p>
        </div>
      </aside>
    );
  }

  const signals = [
    node.bridge ? t("bridge") : null,
    node.duplicateCandidate ? t("duplicate") : null,
    node.unclassified ? t("unclassified") : null,
    node.stale ? t("stale") : null,
  ].filter((signal): signal is string => Boolean(signal));
  const canRefresh = node.stale && node.sourceNoteIds.length > 0;

  return (
    <aside
      data-testid="workspace-atlas-detail-panel"
      className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-[320px] max-w-[calc(100%-1.5rem)] flex-col overflow-y-auto rounded-[var(--radius-control)] border border-border bg-background/95 p-4 shadow-lg"
    >
      <div>
        <h2 className="text-lg font-semibold">{node.label}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("appearsIn", { count: node.projectCount })}
        </p>
        {node.description ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {node.description}
          </p>
        ) : null}
      </div>
      <section className="mt-5">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {t("projects")}
        </h3>
        <div className="mt-2 grid gap-2">
          {node.projectContexts.map((project) => (
            <div
              key={project.projectId}
              className="rounded-[var(--radius-control)] border border-border px-3 py-2"
            >
              <div className="text-sm font-medium">{project.projectName}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {project.conceptIds.length} {t("conceptIds")}
              </div>
            </div>
          ))}
        </div>
      </section>
      {signals.length > 0 ? (
        <section className="mt-5">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            {t("signals")}
          </h3>
          <div className="mt-2 grid gap-2">
            {signals.map((signal) => (
              <div
                key={signal}
                className="rounded-[var(--radius-control)] border border-border bg-muted/30 px-3 py-2 text-sm"
              >
                {signal}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {canRefresh ? (
        <button
          type="button"
          onClick={() => onRefresh(node.sourceNoteIds)}
          disabled={refreshPending}
          className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RotateCw aria-hidden className="h-4 w-4" />
          {refreshPending ? t("refreshing") : t("refresh")}
        </button>
      ) : null}
    </aside>
  );
}

const ATLAS_STYLESHEET: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      shape: "round-rectangle",
      label: "data(label)",
      "font-size": "11px",
      "font-weight": 600,
      color: "#171717",
      "background-color": "#ffffff",
      "border-color": "#e5e5e5",
      "border-width": 1,
      width: "mapData(projectCount, 1, 6, 96, 150)",
      height: "mapData(mentionCount, 0, 20, 38, 58)",
      "text-wrap": "wrap",
      "text-max-width": "120px",
      "text-valign": "center",
      "text-halign": "center",
    },
  },
  {
    selector: 'node[objectType = "concept"]',
    style: {
      shape: "ellipse",
      "background-color": "#38bdf8",
      "border-color": "#0284c7",
      color: "#0f172a",
    },
  },
  {
    selector: 'node[objectType = "note"]',
    style: {
      shape: "round-rectangle",
      "background-color": "#fb7185",
      "border-color": "#e11d48",
      color: "#111827",
    },
  },
  {
    selector: 'node[objectType = "source_bundle"]',
    style: {
      shape: "round-rectangle",
      "background-color": "#fbbf24",
      "border-color": "#d97706",
      color: "#111827",
    },
  },
  {
    selector: 'node[objectType = "artifact"]',
    style: {
      shape: "round-rectangle",
      "background-color": "#a78bfa",
      "border-color": "#7c3aed",
      color: "#111827",
    },
  },
  {
    selector: "node[?bridge]",
    style: {
      "border-width": 3,
      "border-color": "#171717",
    },
  },
  {
    selector: "node[?duplicateCandidate]",
    style: {
      "background-color": "#f5f5f5",
    },
  },
  {
    selector: 'node[layer = "explicit"]',
    style: {
      shape: "round-rectangle",
      "border-style": "solid",
    },
  },
  {
    selector: 'node[layer = "ai"]',
    style: {
      shape: "ellipse",
      "border-style": "dashed",
    },
  },
  {
    selector: "node[?stale]",
    style: {
      "border-style": "dashed",
      opacity: 0.74,
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "#171717",
      "border-width": 4,
    },
  },
  {
    selector: "edge",
    style: {
      "curve-style": "bezier",
      "line-color": "#d4d4d4",
      width: "mapData(weight, 0, 1, 1, 4)",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "#d4d4d4",
      label: "data(label)",
      "font-size": "9px",
      color: "#525252",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.85,
      "text-background-padding": "2px",
    },
  },
  {
    selector: 'edge[edgeType = "co_mention"]',
    style: {
      "line-color": "#86efac",
      "target-arrow-shape": "none",
      "target-arrow-color": "#86efac",
      "line-style": "dashed",
      label: "",
      width: "mapData(weight, 0, 1, 1, 2)",
      opacity: 0.72,
    },
  },
  {
    selector: 'edge[edgeType = "wiki_link"]',
    style: {
      "line-color": "#2563eb",
      "target-arrow-color": "#2563eb",
      width: 2.5,
    },
  },
  {
    selector: 'edge[edgeType = "source_membership"]',
    style: {
      "line-color": "#f59e0b",
      "target-arrow-color": "#f59e0b",
      "line-style": "dashed",
      width: 2.25,
    },
  },
  {
    selector: 'edge[edgeType = "project_tree"]',
    style: {
      "line-color": "#d97706",
      "target-arrow-color": "#d97706",
      "line-style": "solid",
      width: 2,
    },
  },
  {
    selector: 'edge[edgeType = "source_artifact"]',
    style: {
      "line-color": "#7c3aed",
      "target-arrow-color": "#7c3aed",
      width: 2,
    },
  },
  {
    selector: 'edge[edgeType = "ai_relation"]',
    style: {
      "line-color": "#0ea5e9",
      "target-arrow-color": "#0ea5e9",
    },
  },
  {
    selector: 'edge[ontologyPredicate = "is_a"]',
    style: {
      "line-color": "#2563eb",
      "target-arrow-color": "#2563eb",
      width: 3,
    },
  },
  {
    selector: 'edge[ontologyPredicate = "part_of"], edge[ontologyPredicate = "derived_from"]',
    style: {
      "line-color": "#7c3aed",
      "target-arrow-color": "#7c3aed",
      "line-style": "dotted",
      width: 2.5,
    },
  },
  {
    selector: 'edge[ontologyPredicate = "contains"]',
    style: {
      "line-color": "#d97706",
      "target-arrow-color": "#d97706",
      width: 2.5,
    },
  },
  {
    selector: 'edge[ontologyPredicate = "depends_on"]',
    style: {
      "line-color": "#0891b2",
      "target-arrow-color": "#0891b2",
      width: 2.75,
    },
  },
  {
    selector: 'edge[ontologyPredicate = "causes"]',
    style: {
      "line-color": "#dc2626",
      "target-arrow-color": "#dc2626",
      width: 3,
    },
  },
  {
    selector: 'edge[ontologyPredicate = "same_as_candidate"]',
    style: {
      "line-color": "#171717",
      "target-arrow-color": "#171717",
      "line-style": "dotted",
      width: 3,
    },
  },
  {
    selector: 'edge[ontologyPredicate = "appears_with"]',
    style: {
      "target-arrow-shape": "none",
      label: "",
    },
  },
  {
    selector: 'edge[ontologyPredicate = "near_in_source"]',
    style: {
      "line-style": "dashed",
    },
  },
  {
    selector: "edge[?crossProject]",
    style: {
      "line-color": "#171717",
      "target-arrow-color": "#171717",
    },
  },
  {
    selector: 'edge[layer = "explicit"]',
    style: {
      "line-style": "solid",
    },
  },
  {
    selector: 'edge[layer = "ai"]',
    style: {
      "line-style": "dashed",
    },
  },
  {
    selector: "edge[?inferred]",
    style: {
      opacity: 0.82,
    },
  },
  {
    selector: "edge[?stale]",
    style: {
      opacity: 0.58,
    },
  },
  {
    selector: "edge[ontologyValid = false]",
    style: {
      "line-color": "#ef4444",
      "target-arrow-color": "#ef4444",
      "line-style": "dotted",
      opacity: 0.9,
    },
  },
];
