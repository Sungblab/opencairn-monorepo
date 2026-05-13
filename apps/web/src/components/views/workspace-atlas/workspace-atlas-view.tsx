"use client";

import { useMemo, useRef, useState, useEffect, type ComponentType } from "react";
import dynamic from "next/dynamic";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { GitMerge, Network, RotateCw, Search, Workflow } from "lucide-react";
import type {
  WorkspaceAtlasNode,
  WorkspaceAtlasResponse,
} from "@opencairn/shared";
import { useWorkspaceId } from "@/hooks/useWorkspaceId";

const ATLAS_FIT_PADDING = 64;

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

async function fetchWorkspaceAtlas(params: {
  workspaceId: string;
  projectId: string;
  q: string;
}): Promise<WorkspaceAtlasResponse> {
  const query = new URLSearchParams({ limit: "120" });
  if (params.projectId) query.set("projectId", params.projectId);
  if (params.q.trim()) query.set("q", params.q.trim());
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

  const data = atlasQuery.data;
  const selectedNode = useMemo(
    () => data?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [data?.nodes, selectedNodeId],
  );

  const elements = useMemo(() => {
    if (!data) return [];
    const visibleNodes = data.nodes.filter((node) => {
      if (node.layer === "explicit") return showExplicit;
      if (node.layer === "ai") return showAi;
      return showExplicit || showAi;
    });
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const visibleEdges = data.edges.filter((edge) => {
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
          label: edge.relationType,
          edgeType: edge.edgeType,
          layer: edge.layer,
          weight: edge.weight,
          crossProject: edge.crossProject,
          stale: edge.stale,
        },
      })),
    ];
  }, [data, showAi, showExplicit]);

  useEffect(() => {
    if (selectedNodeId && data && !data.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [data, selectedNodeId]);

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
  }, [data]);

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
    const nodes = data?.nodes ?? [];
    return {
      concepts: nodes.filter((node) => node.objectType === "concept").length,
      bridges: nodes.filter((node) => node.bridge).length,
      duplicates: nodes.filter((node) => node.duplicateCandidate).length,
      relations: data?.edges.length ?? 0,
    };
  }, [data]);

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
          <div className="grid grid-cols-4 gap-2">
            <Stat label={t("stats.concepts")} value={stats.concepts} />
            <Stat label={t("stats.bridges")} value={stats.bridges} />
            <Stat label={t("stats.duplicates")} value={stats.duplicates} />
            <Stat label={t("stats.relations")} value={stats.relations} />
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[260px] shrink-0 flex-col gap-4 border-r border-border p-4">
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

        <main className="relative min-w-0 flex-1">
          {atlasQuery.isLoading || !workspaceId ? (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              {t("loading")}
            </div>
          ) : atlasQuery.error ? (
            <div className="grid h-full place-items-center text-sm text-destructive">
              {t("error")}
            </div>
          ) : !data || data.nodes.length === 0 ? (
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
                idealEdgeLength: 130,
                nodeRepulsion: 7000,
                gravity: 0.22,
              } as cytoscape.LayoutOptions}
              stylesheet={ATLAS_STYLESHEET as cytoscape.StylesheetJsonBlock[]}
              cy={(cy: cytoscape.Core) => {
                cyRef.current = cy;
              }}
              style={{ width: "100%", height: "100%" }}
            />
          )}
        </main>

        <AtlasDetail
          node={selectedNode}
          onRefresh={(noteIds) => refreshMutation.mutate(noteIds)}
          refreshPending={refreshMutation.isPending}
        />
      </div>
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
      <aside className="w-[340px] shrink-0 border-l border-border p-4">
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
    <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-border p-4">
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
    selector: "edge[?stale]",
    style: {
      opacity: 0.58,
    },
  },
];
