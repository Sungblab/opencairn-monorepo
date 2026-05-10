import { useTranslations } from "next-intl";

type Item = { q: string; a: string };

export function Faq() {
  const t = useTranslations("landing.faq");
  const items = t.raw("items") as Item[];

  return (
    <section id="faq" className="py-24 md:py-32 border-b border-stone-900">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-10">
        <div className="grid grid-cols-12 gap-8">
          <div className="col-span-12 md:col-span-4 mb-2 md:mb-0">
            <h2 className="kr text-3xl md:text-4xl text-stone-900 tracking-tight font-semibold">{t("title")}</h2>
          </div>
          <div className="col-span-12 md:col-span-8 border-y border-stone-900 divide-y divide-stone-300">
            {items.map((it, i) => (
              <details key={i} className="py-6 group">
                <summary className="flex justify-between items-start gap-6 cursor-pointer kr font-sans text-xl md:text-2xl text-stone-900">
                  <span>{it.q}</span>
                  <span className="font-sans text-stone-500 group-open:rotate-45 transition-transform text-2xl leading-none pt-1">
                    +
                  </span>
                </summary>
                <p className="mt-4 text-[14px] text-stone-600 leading-relaxed kr max-w-[640px]">{it.a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
