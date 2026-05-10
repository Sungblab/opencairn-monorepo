import { useTranslations } from "next-intl";

type Persona = { ver: string; cat: string; title: string; body: string; bullets: string[] };

export function Personas() {
  const t = useTranslations("landing.personas");
  const items = t.raw("items") as Persona[];

  return (
    <section id="who" className="bg-stone-100 py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="mb-14 reveal">
          <h2 className="kr text-3xl md:text-5xl text-stone-900 leading-[1.05] tracking-tight font-semibold mb-5">
            {t("title1")}
            <br />
            {t("title2")}
          </h2>
          <p className="kr text-[15px] text-stone-600 leading-relaxed max-w-[560px]">{t("sub")}</p>
        </div>

        <div className="grid grid-cols-12 border border-stone-900 rounded-2xl overflow-hidden reveal-stagger">
          {items.map((p, i) => (
            <div
              key={i}
              className="col-span-12 md:col-span-4 agent-cell"
              style={i === items.length - 1 ? { borderRight: 0 } : undefined}
            >
              <div className="flex items-baseline justify-between mb-5">
                <span className="font-sans text-[11px] tracking-widest text-stone-900">{p.ver}</span>
                <span className="font-sans text-[10px] tracking-widest text-stone-500 uppercase">{p.cat}</span>
              </div>
              <h3 className="font-sans text-2xl text-stone-900 mb-4">{p.title}</h3>
              <p className="kr text-[13px] text-stone-600 leading-relaxed mb-6">{p.body}</p>
              <ul className="text-[12.5px] text-stone-600 font-sans tracking-wider space-y-1.5">
                {p.bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
