import { useTranslations } from "next-intl";

type Principle = { tag: string; cat: string; title: string; body: string };

export function Comparison() {
  const t = useTranslations("landing.principles");
  const items = t.raw("items") as Principle[];

  return (
    <section id="vs" className="py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="mb-16 reveal">
          <h2 className="kr text-3xl md:text-5xl text-stone-900 leading-[1.05] tracking-tight font-semibold mb-5">
            {t("title1")}
            <br />
            {t("title2")}
          </h2>
          <p className="kr text-[15px] text-stone-600 leading-relaxed max-w-[560px]">{t("sub")}</p>
        </div>

        <div className="grid md:grid-cols-2 gap-x-10 gap-y-12 reveal-stagger">
            {items.map((p, i) => (
              <div key={i} className="pri-col">
                <div className="flex items-baseline gap-3 mb-3">
                  <span className="font-sans text-[11px] tracking-widest text-stone-900">{p.tag}</span>
                  <span className="font-sans text-[10px] tracking-widest text-stone-500 uppercase">{p.cat}</span>
                </div>
                <h3 className="font-sans text-2xl text-stone-900 mb-3">{p.title}</h3>
                <p className="kr text-[13.5px] text-stone-600 leading-relaxed">{p.body}</p>
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}
