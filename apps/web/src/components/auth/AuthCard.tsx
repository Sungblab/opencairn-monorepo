import { clsx } from "clsx";

// White editorial card — mirrors the landing .activity-card chrome but with
// harder borders so it stays crisp on the stone-100 page floor.
export function AuthCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "relative bg-white border-2 border-stone-900 rounded-xl p-7 sm:p-8",
        "shadow-[0_4px_0_0_#171717]",
        className,
      )}
    >
      {children}
    </div>
  );
}
