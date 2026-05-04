"use client";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { Globe, Check, ChevronDown } from "lucide-react";
import { locales, localeNames, type Locale } from "@/i18n-locales";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Tone = "light" | "dark";

type LanguageSwitcherProps = {
  tone?: Tone;
  className?: string;
  contentClassName?: string;
};

const TONE = {
  light: {
    trigger:
      "border-stone-400 text-stone-800 hover:text-stone-50 hover:bg-stone-900 hover:border-stone-900 data-[popup-open]:bg-stone-900 data-[popup-open]:text-stone-50 data-[popup-open]:border-stone-900",
    content:
      "!bg-white !text-stone-900 !ring-stone-900/20 border border-stone-300",
    item:
      "text-stone-900 hover:bg-stone-900 hover:text-stone-50 focus:bg-stone-900 focus:text-stone-50 data-[highlighted]:bg-stone-900 data-[highlighted]:text-stone-50",
    code:
      "text-stone-500 group-hover/dropdown-menu-item:text-stone-300 group-focus/dropdown-menu-item:text-stone-300 group-data-[highlighted]/dropdown-menu-item:text-stone-300",
    name: "text-current",
    check: "text-current",
  },
  dark: {
    trigger:
      "border-stone-600 text-stone-200 hover:text-stone-900 hover:bg-stone-50 hover:border-stone-50 data-[popup-open]:bg-stone-50 data-[popup-open]:text-stone-900 data-[popup-open]:border-stone-50",
    content:
      "!bg-stone-900 !text-stone-50 !ring-stone-50/20 border border-stone-700",
    item:
      "text-stone-50 hover:bg-stone-50 hover:text-stone-900 focus:bg-stone-50 focus:text-stone-900 data-[highlighted]:bg-stone-50 data-[highlighted]:text-stone-900",
    code:
      "text-stone-400 group-hover/dropdown-menu-item:text-stone-600 group-focus/dropdown-menu-item:text-stone-600 group-data-[highlighted]/dropdown-menu-item:text-stone-600",
    name: "text-current",
    check: "text-current",
  },
} as const;

export function LanguageSwitcher({
  tone = "light",
  className,
  contentClassName,
}: LanguageSwitcherProps) {
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
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border-2 bg-transparent px-3 py-1.5 font-sans text-[11px] font-semibold tracking-widest uppercase transition-colors",
          palette.trigger,
          className,
        )}
      >
        <Globe className="h-3.5 w-3.5" aria-hidden />
        <span>{locale}</span>
        <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className={cn(
          "min-w-[180px] rounded-xl p-1.5",
          palette.content,
          contentClassName,
        )}
      >
        {locales.map((loc) => {
          const active = loc === locale;
          return (
            <DropdownMenuItem
              key={loc}
              onClick={() => switchTo(loc)}
              aria-current={active ? "true" : undefined}
              className={`rounded-lg px-2.5 py-2 font-semibold transition-colors ${palette.item}`}
            >
              <span
                className={`w-8 font-sans text-[10px] tracking-widest uppercase ${palette.code}`}
              >
                {loc}
              </span>
              <span className={`kr ${palette.name}`}>{localeNames[loc]}</span>
              {active && (
                <Check
                  className={`ml-auto h-4 w-4 ${palette.check}`}
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
