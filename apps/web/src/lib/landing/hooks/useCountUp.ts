"use client";
import { useEffect, useState, type RefObject } from "react";

export function useCountUp(ref: RefObject<HTMLElement | null>, target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setValue(target);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const start = performance.now();
        function tick(now: number) {
          const p = Math.min(1, (now - start) / duration);
          setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        io.unobserve(e.target);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, target, duration]);
  return value;
}
