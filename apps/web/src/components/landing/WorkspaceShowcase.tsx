import { useTranslations } from "next-intl";

type SideRow = { label: string; count: string; active: boolean };
type WorkflowRun = { role: string; title: string; status: string };

export function WorkspaceShowcase() {
  const t = useTranslations("landing.workspace");

  const sideRows = t.raw("mock.sideRows") as SideRow[];
  const projects = t.raw("mock.projects") as string[];
  const meta = t.raw("mock.pageMeta") as string[];
  const tabs = t.raw("mock.tabs") as string[];
  const relatedItems = t.raw("mock.relatedItems") as string[];
  const backlinks = t.raw("mock.backlinks") as string[];
  const workflowQueue = t.raw("mock.workflow.queue") as string[];
  const workflowRuns = t.raw("mock.workflow.runs") as WorkflowRun[];
  const tags = t.raw("tags") as string[];

  return (
    <section id="workspace" className="scroll-mt-24 bg-stone-100 py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="mb-14 reveal">
          <h2 className="kr text-3xl md:text-5xl text-stone-900 leading-[1.05] tracking-tight font-semibold mb-5">
            {t("title1")}
            <br />
            {t("title2")}
          </h2>
          <p className="kr text-[15px] text-stone-600 leading-relaxed max-w-[560px]">{t("sub")}</p>
        </div>

        <div
          data-testid="landing-workspace-frame"
          className="ws-frame reveal overflow-hidden"
        >
          <div data-testid="landing-workspace-mockup" className="min-w-0 w-full">
          <div className="ws-chrome">
            <div className="flex min-w-0 items-center gap-1">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="ml-3 min-w-0 truncate text-stone-600">{t("mock.chromePath")}</span>
            </div>
            <span className="hidden shrink-0 text-stone-500 sm:inline">⌘ K</span>
          </div>
          <div className="grid grid-cols-12 md:min-h-[480px]">
            <div className="hidden md:block md:col-span-3 ws-side">
              <div className="ws-side-h">{t("mock.sideWorkspace")}</div>
              <div className="mb-4 flex items-center justify-between px-2">
                <span className="font-medium text-stone-900">{t("mock.sideWorkspaceName")}</span>
                <span className="text-stone-500 font-sans text-[10px]">{t("mock.sideWorkspaceMembers")}</span>
              </div>
              <div className="space-y-0.5 mb-5">
                {sideRows.map((row, i) => (
                  <div key={i} className={`ws-side-row${row.active ? " active" : ""}`}>
                    <span>{row.label}</span>
                    <span className={row.active ? "" : "text-stone-500"}>{row.count}</span>
                  </div>
                ))}
              </div>
              <div className="ws-side-h">{t("mock.sideProjects")}</div>
              <div className="space-y-0.5">
                {projects.map((p, i) => (
                  <div key={i} className="ws-side-row">
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="col-span-12 md:col-span-6 ws-main md:[border-right:1px_solid_#D4D4D4]">
              <div className="-mx-7 -mt-7 mb-6 flex min-w-0 border-b border-stone-200 bg-stone-50/80 px-4 pt-3">
                {tabs.map((tab, i) => (
                  <div
                    key={tab}
                    className={`min-w-0 max-w-[180px] truncate border-x border-t border-stone-200 px-3 py-2 font-sans text-[11px] ${
                      i === 0
                        ? "bg-white text-stone-900"
                        : "-ml-px bg-stone-100 text-stone-500"
                    }`}
                  >
                    {tab}
                  </div>
                ))}
              </div>
              <div className="ws-breadcrumb">{t("mock.breadcrumb")}</div>
              <h3 className="font-sans text-3xl text-stone-900 kr mb-3">{t("mock.pageTitle")}</h3>
              <div className="mb-5 flex items-center gap-3 font-sans text-[10.5px] text-stone-500">
                {meta.map((m, i) => (
                  <span key={i}>
                    {i > 0 ? "· " : ""}
                    {m}
                  </span>
                ))}
              </div>
              <div className="border-t border-stone-200 pt-4" />
              <p className="text-[13px] text-stone-700 leading-relaxed kr mb-4">{t("mock.body")}</p>
              <div className="ws-callout kr">
                <b className="text-stone-900">{t("mock.calloutTitle")}</b>
                <br />
                <span className="mt-1 block text-stone-700">{t("mock.calloutBody")}</span>
              </div>
              <p className="text-[13px] text-stone-700 leading-relaxed kr">
                {t("mock.related")}{" "}
                {relatedItems.map((it, i) => (
                  <span key={i}>
                    {i > 0 && ", "}
                    <span className="underline decoration-stone-400 underline-offset-2">{it}</span>
                  </span>
                ))}
                .
              </p>
              <div className="mt-5 rounded-md border border-stone-300 bg-stone-50 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-sans text-[10px] tracking-[0.18em] text-stone-500 uppercase">
                      {t("mock.agentPanelTitle")}
                    </div>
                    <h4 className="mt-1 font-sans text-sm font-semibold text-stone-900 kr">
                      {t("mock.reviewCard.title")}
                    </h4>
                    <p className="mt-1 text-[11px] text-stone-500 kr">
                      {t("mock.reviewCard.summary")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="inline-flex h-7 items-center rounded border border-stone-300 px-2 font-sans text-[11px] text-stone-600">
                      {t("mock.reviewCard.reject")}
                    </span>
                    <span className="inline-flex h-7 items-center rounded bg-stone-900 px-2 font-sans text-[11px] text-stone-50">
                      {t("mock.reviewCard.apply")}
                    </span>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <PreviewBlock
                    label={t("mock.reviewCard.currentLabel")}
                    text={t("mock.reviewCard.current")}
                  />
                  <PreviewBlock
                    label={t("mock.reviewCard.draftLabel")}
                    text={t("mock.reviewCard.draft")}
                  />
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-stone-500 kr">
                  {t("mock.reviewCard.warning")}
                </p>
              </div>
            </div>
            <div className="hidden md:block md:col-span-3 ws-rail" style={{ borderLeft: 0 }}>
              <div className="ws-rail-h">{t("mock.workflow.title")}</div>
              <div className="mb-4 rounded border border-stone-200 bg-stone-50 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stone-900/40" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-stone-900" />
                  </span>
                  <span className="truncate font-sans text-[11px] font-medium text-stone-900">
                    {t("mock.workflow.active")}
                  </span>
                </div>
                <p className="mt-1 truncate pl-5 text-[11px] text-stone-500 kr">
                  {t("mock.workflow.activeTitle")}
                </p>
              </div>
              <div className="mb-4 rounded border border-stone-200 bg-white px-3 py-2">
                <div className="mb-2 font-sans text-[10px] tracking-[0.16em] text-stone-500 uppercase">
                  {t("mock.workflow.queueTitle")}
                </div>
                <div className="space-y-1.5">
                  {workflowQueue.map((item) => (
                    <div key={item} className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] text-stone-700 kr">{item}</span>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" />
                    </div>
                  ))}
                </div>
              </div>
              {workflowRuns.map((run) => (
                <div key={`${run.role}:${run.title}`} className="ws-feed-item">
                  <div className="ws-feed-agent">{run.role}</div>
                  <div className="ws-feed-text kr">
                    <span className="block">{run.title}</span>
                    <span className="mt-1 inline-block rounded bg-stone-100 px-1.5 py-0.5 font-sans text-[10px] text-stone-500">
                      {run.status}
                    </span>
                  </div>
                </div>
              ))}
              <div className="mt-6 pt-4 border-t border-stone-200">
                <div className="ws-rail-h">{t("mock.workflow.output")}</div>
                <ul className="space-y-1 text-[12px] text-stone-700 font-sans">
                  {backlinks.map((b, i) => (
                    <li key={i} className={i === backlinks.length - 1 ? "text-stone-500" : undefined}>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-5 font-sans text-[11px] tracking-widest uppercase text-stone-500">
          {tags.map((tag, i) => (
            <span key={i}>{tag}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

function PreviewBlock({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-3">
      <div className="mb-1 font-sans text-[10px] font-semibold tracking-[0.14em] text-stone-500 uppercase">
        {label}
      </div>
      <p className="line-clamp-4 text-[12px] leading-relaxed text-stone-700 kr">{text}</p>
    </div>
  );
}
