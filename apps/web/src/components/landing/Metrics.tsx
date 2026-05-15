import { useTranslations } from "next-intl";

type MetricItem = { value: number | string; suffix: string; caption: string };

function CountValue({ target, suffix }: { target: number; suffix: string }) {
  return (
    <span className="tick">
      {target}
      {suffix}
    </span>
  );
}

export function Metrics() {
  const t = useTranslations("landing.metrics");
  const items = t.raw("items") as MetricItem[];

  return (
    <section className="border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10 py-12">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4 md:gap-8 reveal-stagger">
          {items.map((m, i) => (
            <div key={i} className="min-w-0 border-l border-stone-900 pl-4 md:pl-5">
              <div className="font-sans text-3xl text-stone-900 leading-none sm:text-4xl">
                {typeof m.value === "number" ? (
                  <CountValue target={m.value} suffix={m.suffix} />
                ) : (
                  <span>{m.value}</span>
                )}
              </div>
              <div className="font-sans text-[11px] tracking-widest uppercase text-stone-500 mt-3">
                {m.caption}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
