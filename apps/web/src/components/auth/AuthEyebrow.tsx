import { cn } from "@/lib/utils";

// Editorial label with pulse dot — reuses the landing Hero "SEC · label"
// pattern (see globals.css .sec-label / .pulse-dot).
export function AuthEyebrow({
  label,
  tone = "dark",
  className,
}: {
  label: string;
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "w-2 h-2 rounded-full pulse-dot",
          tone === "light" ? "bg-stone-400" : "bg-stone-900",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "font-sans text-[11px] font-semibold tracking-[0.18em] uppercase",
          tone === "light" ? "text-stone-400" : "text-stone-900",
        )}
      >
        {label}
      </span>
    </div>
  );
}
