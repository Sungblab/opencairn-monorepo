"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";

const nodes = [
  { id: "attention", x: 160, y: 130, label: "Attention" },
  { id: "transformer", x: 300, y: 150, label: "Transformer" },
  { id: "multihead", x: 180, y: 240, label: "Multi-head" },
  { id: "positional", x: 420, y: 110, label: "Positional" },
  { id: "encoder", x: 360, y: 260, label: "Encoder" },
  { id: "decoder", x: 500, y: 270, label: "Decoder" },
  { id: "bert", x: 470, y: 200, label: "BERT" },
  { id: "rope", x: 540, y: 120, label: "RoPE" },
  { id: "pretraining", x: 540, y: 270, label: "Pretraining" },
];

const edges: [string, string][] = [
  ["attention", "transformer"],
  ["attention", "multihead"],
  ["transformer", "encoder"],
  ["transformer", "decoder"],
  ["positional", "transformer"],
  ["encoder", "bert"],
  ["bert", "pretraining"],
  ["rope", "positional"],
  ["decoder", "pretraining"],
];

export function MiniGraph() {
  const t = useTranslations("landing.try");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const [hovered, setHovered] = useState<string | null>(null);

  const connected = new Set<string>(
    hovered
      ? edges.flatMap(([a, b]) => (a === hovered || b === hovered ? [a, b] : []))
      : []
  );

  return (
    <section
      id="try"
      ref={ref}
      className="reveal border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">
          {t("heading")}
        </h2>
        <div className="mt-10 rounded-xl border border-[color:var(--brand-stone-200)] bg-[color:var(--brand-stone-50)] p-6">
          <svg viewBox="0 0 700 400" className="w-full">
            <defs>
              <pattern id="mg-dot" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="var(--brand-stone-200)" />
              </pattern>
            </defs>
            <rect width="700" height="400" fill="url(#mg-dot)" />
            <g>
              {edges.map(([a, b], i) => {
                const na = nodes.find((n) => n.id === a)!;
                const nb = nodes.find((n) => n.id === b)!;
                const active = hovered && (a === hovered || b === hovered);
                return (
                  <line
                    key={i}
                    x1={na.x}
                    y1={na.y}
                    x2={nb.x}
                    y2={nb.y}
                    stroke={active ? "var(--brand-ember-cta)" : "var(--brand-stone-300)"}
                    strokeWidth={active ? 2 : 1}
                  />
                );
              })}
            </g>
            <g>
              {nodes.map((n) => {
                const active = n.id === hovered || connected.has(n.id);
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    onMouseEnter={() => setHovered(n.id)}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      r="16"
                      fill={active ? "var(--brand-stone-900)" : "var(--brand-paper)"}
                      stroke="var(--brand-stone-900)"
                      strokeWidth="1.5"
                    />
                    <text
                      y="30"
                      textAnchor="middle"
                      fontSize="10"
                      fill="var(--brand-stone-700)"
                      className="font-mono"
                    >
                      {n.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    </section>
  );
}
