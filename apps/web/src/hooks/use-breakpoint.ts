"use client";
import { useEffect, useState } from "react";

// Tailwind-aligned breakpoints: lg corresponds to >=1024px, where the shell
// is allowed to render its three-pane desktop layout. Anything narrower
// degrades to the single-column + Sheet overlay variant (Phase 1 Task 12).
export type Breakpoint = "xs" | "sm" | "md" | "lg";

function compute(width: number): Breakpoint {
  if (width >= 1024) return "lg";
  if (width >= 768) return "md";
  if (width >= 640) return "sm";
  return "xs";
}

export function useBreakpoint(): Breakpoint {
  // SSR fallback to "lg" so the desktop shell renders during the first paint
  // for the >99% of visitors on >=1024px viewports — narrow viewports get a
  // one-frame layout shift after hydration, which is the right tradeoff
  // versus locking everyone behind a "loading" gate.
  const [bp, setBp] = useState<Breakpoint>("lg");

  useEffect(() => {
    const handler = () => setBp(compute(window.innerWidth));
    window.addEventListener("resize", handler);
    // Pick up any width that changed between SSR's "lg" guess and the
    // first effect tick (e.g., a phone visitor).
    handler();
    return () => window.removeEventListener("resize", handler);
  }, []);

  return bp;
}
