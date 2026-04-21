"use client";
import { useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

type View = { n: string; cat: string; name: string; body: string };

function GraphSvg() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-24 mb-3">
      <circle cx={50} cy={40} r={8} fill="#403C32" />
      <circle cx={20} cy={20} r={5} fill="#403C32" />
      <circle cx={80} cy={20} r={5} fill="#403C32" />
      <circle cx={20} cy={60} r={5} fill="#403C32" />
      <circle cx={80} cy={60} r={5} fill="#403C32" />
      <circle cx={50} cy={10} r={4} fill="#A89E8B" />
      <circle cx={50} cy={70} r={4} fill="#A89E8B" />
      <line x1={50} y1={40} x2={20} y2={20} stroke="#7C7462" strokeWidth={0.5} />
      <line x1={50} y1={40} x2={80} y2={20} stroke="#7C7462" strokeWidth={0.5} />
      <line x1={50} y1={40} x2={20} y2={60} stroke="#7C7462" strokeWidth={0.5} />
      <line x1={50} y1={40} x2={80} y2={60} stroke="#7C7462" strokeWidth={0.5} />
      <line x1={50} y1={40} x2={50} y2={10} stroke="#7C7462" strokeWidth={0.5} />
      <line x1={50} y1={40} x2={50} y2={70} stroke="#7C7462" strokeWidth={0.5} />
    </svg>
  );
}
function MindmapSvg() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-24 mb-3">
      <circle cx={18} cy={40} r={6} fill="#403C32" />
      <line x1={24} y1={40} x2={45} y2={15} stroke="#7C7462" strokeWidth={0.5} />
      <line x1={24} y1={40} x2={45} y2={40} stroke="#7C7462" strokeWidth={0.5} />
      <line x1={24} y1={40} x2={45} y2={65} stroke="#7C7462" strokeWidth={0.5} />
      <circle cx={48} cy={15} r={4} fill="#403C32" />
      <circle cx={48} cy={40} r={4} fill="#403C32" />
      <circle cx={48} cy={65} r={4} fill="#403C32" />
      <line x1={52} y1={15} x2={72} y2={10} stroke="#A89E8B" strokeWidth={0.4} />
      <line x1={52} y1={15} x2={72} y2={22} stroke="#A89E8B" strokeWidth={0.4} />
      <line x1={52} y1={40} x2={72} y2={38} stroke="#A89E8B" strokeWidth={0.4} />
      <line x1={52} y1={40} x2={72} y2={48} stroke="#A89E8B" strokeWidth={0.4} />
      <line x1={52} y1={65} x2={72} y2={60} stroke="#A89E8B" strokeWidth={0.4} />
      <circle cx={76} cy={10} r={2.5} fill="#A89E8B" />
      <circle cx={76} cy={22} r={2.5} fill="#A89E8B" />
      <circle cx={76} cy={38} r={2.5} fill="#A89E8B" />
      <circle cx={76} cy={48} r={2.5} fill="#A89E8B" />
      <circle cx={76} cy={60} r={2.5} fill="#A89E8B" />
    </svg>
  );
}
function CardsSvg() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-24 mb-3">
      <rect x={8} y={10} width={24} height={24} fill="#FDFBF5" stroke="#403C32" strokeWidth={0.8} />
      <rect x={38} y={10} width={24} height={24} fill="#FDFBF5" stroke="#403C32" strokeWidth={0.8} />
      <rect x={68} y={10} width={24} height={24} fill="#EDEAE2" stroke="#1C1917" strokeWidth={1} />
      <rect x={8} y={44} width={24} height={24} fill="#FDFBF5" stroke="#403C32" strokeWidth={0.8} />
      <rect x={38} y={44} width={24} height={24} fill="#FDFBF5" stroke="#403C32" strokeWidth={0.8} />
      <rect x={68} y={44} width={24} height={24} fill="#FDFBF5" stroke="#403C32" strokeWidth={0.8} />
      <line x1={12} y1={18} x2={28} y2={18} stroke="#A89E8B" strokeWidth={0.6} />
      <line x1={42} y1={18} x2={58} y2={18} stroke="#A89E8B" strokeWidth={0.6} />
      <line x1={72} y1={18} x2={88} y2={18} stroke="#1C1917" strokeWidth={1} />
    </svg>
  );
}
function CanvasSvg() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-24 mb-3">
      <rect x={5} y={5} width={90} height={70} fill="#FDFBF5" stroke="#D3CCBE" strokeDasharray="2 2" />
      <rect x={12} y={20} width={28} height={16} fill="#EDEAE2" stroke="#1C1917" />
      <rect x={55} y={12} width={24} height={20} fill="#FDFBF5" stroke="#403C32" />
      <rect x={28} y={48} width={32} height={18} fill="#FDFBF5" stroke="#403C32" />
      <rect x={68} y={52} width={20} height={14} fill="#EDEAE2" stroke="#1C1917" />
      <line x1={40} y1={28} x2={55} y2={22} stroke="#7C7462" strokeWidth={0.5} />
      <line x1={44} y1={57} x2={55} y2={22} stroke="#7C7462" strokeWidth={0.5} />
    </svg>
  );
}
function TimelineSvg() {
  return (
    <svg viewBox="0 0 100 80" className="w-full h-24 mb-3">
      <line x1={10} y1={40} x2={90} y2={40} stroke="#403C32" strokeWidth={0.8} />
      <line x1={20} y1={35} x2={20} y2={45} stroke="#403C32" strokeWidth={0.8} />
      <line x1={40} y1={35} x2={40} y2={45} stroke="#403C32" strokeWidth={0.8} />
      <line x1={60} y1={35} x2={60} y2={45} stroke="#403C32" strokeWidth={0.8} />
      <line x1={80} y1={35} x2={80} y2={45} stroke="#403C32" strokeWidth={0.8} />
      <circle cx={20} cy={25} r={4} fill="#403C32" />
      <circle cx={40} cy={55} r={4} fill="#403C32" />
      <circle cx={60} cy={20} r={4} fill="#1C1917" />
      <circle cx={80} cy={60} r={4} fill="#403C32" />
    </svg>
  );
}

const SVGS: ReactNode[] = [<GraphSvg key="g" />, <MindmapSvg key="m" />, <CardsSvg key="c" />, <CanvasSvg key="cv" />, <TimelineSvg key="t" />];

export function FiveViews() {
  const t = useTranslations("landing.views");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const items = t.raw("items") as View[];

  return (
    <section ref={ref} className="bg-stone-100 py-24 md:py-32 border-y border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-6 mb-16 reveal">
          <div className="col-span-12 md:col-span-3">
            <span className="sec-label">
              <span className="n">{t("label")}</span>
            </span>
          </div>
          <div className="col-span-12 md:col-span-9">
            <h2 className="kr text-3xl md:text-5xl text-stone-900 leading-[1.05] tracking-tight font-semibold mb-5">
              {t("title")}
            </h2>
            <p className="kr text-[15px] text-stone-600 leading-relaxed max-w-[560px]">
              {t("sub")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 border border-stone-900 rounded-2xl overflow-hidden reveal-stagger">
          {items.map((v, i) => (
            <div key={i} className="agent-cell" style={i === items.length - 1 ? { borderRight: 0 } : undefined}>
              <div className="flex items-baseline justify-between mb-3">
                <span className="font-mono text-[11px] tracking-widest text-stone-900">{v.n}</span>
                <span className="font-mono text-[10px] tracking-widest text-stone-500 uppercase">{v.cat}</span>
              </div>
              {SVGS[i]}
              <div className="font-serif text-lg text-stone-900 mb-1">{v.name}</div>
              <p className="kr text-[14px] text-stone-600 leading-relaxed">{v.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
