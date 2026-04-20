"use client";
import { useRef } from "react";
import { useTranslations } from "next-intl";
import { useScrollReveal } from "@/lib/landing/hooks/useScrollReveal";
import { useMagneticTilt } from "@/lib/landing/hooks/useMagneticTilt";

function AgentCard({ title, body }: { title: string; body: string }) {
  const ref = useRef<HTMLElement>(null);
  useMagneticTilt(ref);
  return (
    <article
      ref={ref}
      className="rounded-xl border border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)] p-6 transition-shadow hover:shadow-lg"
    >
      <h3 className="font-serif text-xl text-[color:var(--brand-stone-900)]">{title}</h3>
      <p className="mt-2 text-sm text-[color:var(--brand-stone-600)]">{body}</p>
    </article>
  );
}

export function AgentsGrid() {
  const t = useTranslations("landing.agents");
  const ref = useRef<HTMLElement>(null);
  useScrollReveal(ref);
  const agents = t.raw("items") as { title: string; body: string }[];

  return (
    <section
      id="agents"
      ref={ref}
      className="reveal border-b border-[color:var(--brand-stone-200)] bg-[color:var(--brand-paper)] py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-serif text-4xl text-[color:var(--brand-stone-900)] md:text-5xl">
          {t("heading")}
        </h2>
        <div className="mt-12 grid gap-6 md:grid-cols-3 lg:grid-cols-4">
          {agents.map((a, i) => (
            <AgentCard key={i} title={a.title} body={a.body} />
          ))}
        </div>
      </div>
    </section>
  );
}
