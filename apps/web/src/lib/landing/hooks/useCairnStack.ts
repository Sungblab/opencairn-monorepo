"use client";
import { useEffect, type RefObject } from "react";

export function useCairnStack(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function onClick() {
      if (reduce || !el) return;
      el.animate(
        [
          { transform: "translateY(0)" },
          { transform: "translateY(-4px)" },
          { transform: "translateY(0)" },
        ],
        { duration: 320, easing: "cubic-bezier(0.22,0.61,0.36,1)" }
      );
    }
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [ref]);
}
