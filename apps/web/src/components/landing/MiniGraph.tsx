"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

type NodeSpec = { id: string; x: number; y: number; r: number; anchor: "start" | "middle" | "end"; tx: number; ty: number; bold?: boolean };
type EdgeSpec = { e: string; d: string };

const NODES: NodeSpec[] = [
  { id: "attention", x: 160, y: 130, r: 8, anchor: "middle", tx: 0, ty: -14 },
  { id: "transformer", x: 300, y: 150, r: 10, anchor: "middle", tx: 0, ty: -16, bold: true },
  { id: "multihead", x: 180, y: 240, r: 7, anchor: "middle", tx: 0, ty: 22 },
  { id: "positional", x: 420, y: 110, r: 7, anchor: "middle", tx: 0, ty: -14 },
  { id: "encoder", x: 360, y: 260, r: 7, anchor: "middle", tx: 0, ty: 22 },
  { id: "decoder", x: 500, y: 270, r: 7, anchor: "end", tx: -14, ty: 4 },
  { id: "bert", x: 470, y: 200, r: 7, anchor: "middle", tx: 0, ty: -14 },
  { id: "rope", x: 540, y: 120, r: 7, anchor: "middle", tx: 0, ty: -14 },
  { id: "pretraining", x: 540, y: 270, r: 7, anchor: "middle", tx: 0, ty: 22 },
];

const EDGES: EdgeSpec[] = [
  { e: "attention|transformer", d: "M 160 130 Q 230 110 300 150" },
  { e: "attention|multihead", d: "M 160 130 Q 130 180 180 240" },
  { e: "transformer|positional", d: "M 300 150 Q 360 140 420 110" },
  { e: "transformer|encoder", d: "M 300 150 Q 310 210 360 260" },
  { e: "transformer|bert", d: "M 300 150 Q 390 180 470 200" },
  { e: "multihead|attention", d: "M 180 240 Q 140 200 160 130" },
  { e: "encoder|decoder", d: "M 360 260 Q 430 280 500 270" },
  { e: "positional|rope", d: "M 420 110 Q 490 90 540 120" },
  { e: "bert|pretraining", d: "M 470 200 Q 520 230 540 270" },
];

const BACKLINK_COUNT: Record<string, number> = {
  attention: 8, transformer: 14, multihead: 6, positional: 5, encoder: 4,
  decoder: 3, bert: 9, rope: 4, pretraining: 7,
};

const LINKS_MAP: Record<string, string[]> = {
  attention: ["multihead", "transformer"],
  transformer: ["attention", "positional", "encoder", "bert"],
  multihead: ["attention"],
  positional: ["transformer", "rope"],
  encoder: ["transformer", "decoder"],
  decoder: ["encoder"],
  bert: ["transformer", "pretraining"],
  rope: ["positional"],
  pretraining: ["bert"],
};

type GraphCopy = Record<string, { t: string; d: string }>;

export function MiniGraph() {
  const t = useTranslations("landing.try");
  const ref = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  useScrollReveal(ref);

  const bullets = t.raw("bullets") as string[];
  const graph = t.raw("graph") as GraphCopy;
  const backlinksLabel = t("backlinks");

  const [active, setActive] = useState<string | null>(null);
  const autoPausedRef = useRef(false);

  const activate = (id: string, clientX: number, clientY: number) => {
    setActive(id);
    const panel = panelRef.current;
    const tip = tooltipRef.current;
    if (!panel || !tip) return;
    const r = panel.getBoundingClientRect();
    let x = clientX - r.left + 14;
    let y = clientY - r.top + 14;
    if (x + 280 > r.width) x = clientX - r.left - 280;
    if (y + 120 > r.height) y = clientY - r.top - 120;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  };

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const ids = NODES.map((n) => n.id);
    let i = 0;
    const tick = () => {
      if (autoPausedRef.current) return;
      const id = ids[i % ids.length];
      const panel = panelRef.current;
      if (!panel) return;
      const nodeEl = panel.querySelector(`[data-id="${id}"] circle`) as SVGCircleElement | null;
      if (nodeEl) {
        const rect = nodeEl.getBoundingClientRect();
        activate(id, rect.left + rect.width / 2, rect.top + rect.height / 2);
      }
      i++;
    };
    const start = setTimeout(tick, 1200);
    const iv = setInterval(tick, 3200);
    return () => { clearTimeout(start); clearInterval(iv); };
  }, []);

  const current = active ? graph[active] : null;
  const currentLinks = active ? LINKS_MAP[active] ?? [] : [];
  const currentBacklinks = active ? BACKLINK_COUNT[active] ?? 0 : 0;

  return (
    <section ref={ref} id="try" className="py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-6 mb-12 reveal">
          <div className="col-span-12 md:col-span-3">
            <span className="sec-label">
              <span className="n">{t("label")}</span>
            </span>
          </div>
          <div className="col-span-12 md:col-span-9">
            <h2 className="kr text-3xl md:text-5xl text-stone-900 leading-[1.05] tracking-tight font-semibold mb-5">
              {t("title1")}
              <br />
              {t("title2")}
            </h2>
            <p className="kr text-[15px] text-stone-600 leading-relaxed max-w-[560px]">
              {t("sub")}
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-12 gap-8 items-stretch">
          <div className="md:col-span-4 reveal">
            <ul className="text-[13.5px] text-stone-600 kr space-y-3 border-t border-stone-900 pt-6">
              {bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="font-sans text-[11px] tracking-widest text-stone-900 pt-0.5">◆</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div
            ref={panelRef}
            className="md:col-span-8 mini-graph reveal relative"
            onMouseEnter={() => { autoPausedRef.current = true; }}
            onMouseLeave={() => { setActive(null); }}
          >
            <svg viewBox="0 0 600 340" preserveAspectRatio="xMidYMid meet">
              <defs>
                <pattern id="mg-dot" x={0} y={0} width={24} height={24} patternUnits="userSpaceOnUse">
                  <circle cx={1} cy={1} r={0.8} fill="#A3A3A3" opacity={0.5} />
                </pattern>
              </defs>
              <rect width={600} height={340} fill="url(#mg-dot)" />
              <g>
                {EDGES.map((ed, i) => {
                  const [a, b] = ed.e.split("|");
                  const isActive = active !== null && (a === active || b === active);
                  return <path key={i} className={`mg-edge${isActive ? " active" : ""}`} d={ed.d} />;
                })}
              </g>
              <g>
                {NODES.map((n) => (
                  <g
                    key={n.id}
                    className={`mg-node${active === n.id ? " active" : ""}`}
                    data-id={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    onMouseEnter={(e) => activate(n.id, e.clientX, e.clientY)}
                    onMouseMove={(e) => activate(n.id, e.clientX, e.clientY)}
                    onClick={(e) => activate(n.id, e.clientX, e.clientY)}
                  >
                    <circle r={n.r} fill="#262626" stroke="#FFEDD5" strokeWidth={2} />
                    <text
                      x={n.tx}
                      y={n.ty}
                      textAnchor={n.anchor}
                      fontFamily="Inter"
                      fontSize={n.bold ? 12 : 11}
                      fontWeight={n.bold ? 600 : undefined}
                      fill={n.bold ? "#171717" : "#262626"}
                    >
                      {graph[n.id]?.t ?? n.id}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
            <div ref={tooltipRef} className={`mg-tooltip${active ? " show" : ""}`}>
              {current && (
                <>
                  <div className="t-title">{current.t}</div>
                  <div className="t-desc">{current.d}</div>
                  <div className="t-links">
                    {backlinksLabel} {currentBacklinks} ·{" "}
                    {currentLinks.map((l) => `→ ${graph[l]?.t ?? l}`).join(" · ")}
                  </div>
                </>
              )}
            </div>
            <div className="absolute bottom-3 left-4 font-sans text-[10px] text-stone-400 tracking-widest uppercase">
              {t("caption")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
