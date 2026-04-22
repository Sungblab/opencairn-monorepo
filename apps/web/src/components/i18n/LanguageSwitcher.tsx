"use client";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Globe, Check, ChevronDown } from "lucide-react";
import { locales, localeNames, type Locale } from "@/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Tone = "light" | "dark";

const TONE = {
  light: {
    trigger:
      "border-stone-300 text-stone-600 hover:text-stone-900 hover:bg-stone-100 hover:border-stone-400 data-[popup-open]:bg-stone-100 data-[popup-open]:text-stone-900 data-[popup-open]:border-stone-400",
    code: "text-stone-400",
    name: "text-stone-800",
    check: "text-stone-700",
  },
  dark: {
    trigger:
      "border-stone-700 text-stone-300 hover:text-stone-50 hover:bg-stone-800 hover:border-stone-500 data-[popup-open]:bg-stone-800 data-[popup-open]:text-stone-50 data-[popup-open]:border-stone-500",
    code: "text-stone-500",
    name: "text-stone-100",
    check: "text-stone-200",
  },
} as const;

export function LanguageSwitcher({ tone = "light" }: { tone?: Tone }) {
  const t = useTranslations("common.language");
  const locale = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const palette = TONE[tone];

  const switchTo = (next: Locale) => {
    if (next === locale) return;
    const stripped = pathname.replace(new RegExp(`^/${locale}(?=/|$)`), "");
    router.push(`/${next}${stripped || ""}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("menuLabel")}
        className={`inline-flex items-center gap-1.5 rounded-md border bg-transparent px-2.5 py-1.5 font-sans text-[11px] tracking-widest uppercase transition-colors ${palette.trigger}`}
      >
        <Globe className="h-3.5 w-3.5" aria-hidden />
        <span>{locale}</span>
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="min-w-[160px]">
        {locales.map((loc) => {
          const active = loc === locale;
          return (
            <DropdownMenuItem
              key={loc}
              onClick={() => switchTo(loc)}
              aria-current={active ? "true" : undefined}
            >
              <span
                className={`w-7 font-sans text-[10px] tracking-widest uppercase ${palette.code}`}
              >
                {loc}
              </span>
              <span className={`kr ${palette.name}`}>{localeNames[loc]}</span>
              {active && (
                <Check
                  className={`ml-auto h-3.5 w-3.5 ${palette.check}`}
                  aria-hidden
                />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
