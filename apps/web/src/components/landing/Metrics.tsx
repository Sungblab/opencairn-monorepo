"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

type MetricItem = { value: number | string; suffix: string; caption: string };

function CountValue({ target, suffix }: { target: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || target === 0) {
      setN(target);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const start = performance.now();
        const dur = 1200;
        function step(now: number) {
          const p = Math.min(1, (now - start) / dur);
          setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
        io.unobserve(e.target);
      }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [target]);
  return (
    <span ref={ref} className="tick">
      {n}
      {suffix}
    </span>
  );
}

export function Metrics() {
  const t = useTranslations("landing.metrics");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const items = t.raw("items") as MetricItem[];

  return (
    <section ref={ref} className="border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-12">
        <div className="grid grid-cols-12 gap-6 items-end">
          <div className="col-span-12 md:col-span-3 mb-4 md:mb-0">
            <span className="sec-label">
              <span className="n">{t("label")}</span>
            </span>
          </div>
          <div className="col-span-12 md:col-span-9 grid grid-cols-2 md:grid-cols-4 gap-8 reveal-stagger">
            {items.map((m, i) => (
              <div key={i} className="border-l border-stone-900 pl-5">
                <div className="font-serif text-4xl text-stone-900 leading-none">
                  {typeof m.value === "number" ? (
                    <CountValue target={m.value} suffix={m.suffix} />
                  ) : (
                    <span>{m.value}</span>
                  )}
                </div>
                <div className="font-mono text-[11px] tracking-widest uppercase text-stone-500 mt-3">
                  {m.caption}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
