"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

type SideRow = { label: string; count: string; active: boolean };
type FeedItem = { agent: string; text: string; faded?: boolean };

export function WorkspaceShowcase() {
  const t = useTranslations("landing.workspace");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);

  const sideRows = t.raw("mock.sideRows") as SideRow[];
  const projects = t.raw("mock.projects") as string[];
  const meta = t.raw("mock.pageMeta") as string[];
  const relatedItems = t.raw("mock.relatedItems") as string[];
  const feed = t.raw("mock.feed") as FeedItem[];
  const backlinks = t.raw("mock.backlinks") as string[];
  const tags = t.raw("tags") as string[];

  return (
    <section ref={ref} id="workspace" className="bg-stone-100 py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="mb-14 reveal">
          <h2 className="kr text-3xl md:text-5xl text-stone-900 leading-[1.05] tracking-tight font-semibold mb-5">
            {t("title1")}
            <br />
            {t("title2")}
          </h2>
          <p className="kr text-[15px] text-stone-600 leading-relaxed max-w-[560px]">{t("sub")}</p>
        </div>

        <div className="ws-frame reveal md:overflow-x-auto">
          <div className="md:min-w-[920px]">
          <div className="ws-chrome">
            <div className="flex items-center gap-1">
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
              <span className="ml-3 text-stone-600 truncate">{t("mock.chromePath")}</span>
            </div>
            <span className="text-stone-500 shrink-0">⌘ K</span>
          </div>
          <div className="grid grid-cols-12 md:min-h-[440px]">
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
              <div className="ws-breadcrumb">{t("mock.breadcrumb")}</div>
              <h3 className="font-sans text-3xl text-stone-900 kr mb-3">{t("mock.pageTitle")}</h3>
              <div className="flex items-center gap-3 mb-5 font-sans text-[10.5px] text-stone-500">
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
            </div>
            <div className="hidden md:block md:col-span-3 ws-rail" style={{ borderLeft: 0 }}>
              <div className="ws-rail-h">{t("mock.railFeedH")}</div>
              {feed.map((f, i) => (
                <div key={i} className="ws-feed-item">
                  <div className="ws-feed-agent" style={f.faded ? { color: "#525252" } : undefined}>
                    {f.agent}
                  </div>
                  <div className="ws-feed-text kr" style={f.faded ? { color: "#525252" } : undefined}>
                    {f.text}
                  </div>
                </div>
              ))}
              <div className="mt-6 pt-4 border-t border-stone-200">
                <div className="ws-rail-h">{t("mock.backlinksH")}</div>
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
