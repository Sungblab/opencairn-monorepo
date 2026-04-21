"use client";
import { useEffect, type RefObject } from "react";

export function useScrollReveal(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targets: HTMLElement[] = [];
    if (root.classList.contains("reveal") || root.classList.contains("reveal-stagger")) {
      targets.push(root);
    }
    root.querySelectorAll<HTMLElement>(".reveal, .reveal-stagger").forEach((el) => targets.push(el));
    if (targets.length === 0) return;

    if (reduce) {
      for (const el of targets) el.classList.add("in");
      return;
    }

    // Double rAF lets the browser restore scroll position before we measure,
    // so getBoundingClientRect() reflects the actual restored position.
    let cancelled = false;
    let io: IntersectionObserver;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                (e.target as HTMLElement).classList.add("in");
                io.unobserve(e.target);
              }
            }
          },
          { threshold: 0.08, rootMargin: "0px 0px -10% 0px" }
        );
        for (const el of targets) {
          // Elements already scrolled past (above viewport) get revealed immediately.
          if (el.getBoundingClientRect().bottom < 0) {
            el.classList.add("in");
          } else {
            io.observe(el);
          }
        }
      });
    });
    return () => {
      cancelled = true;
      io?.disconnect();
    };
  }, [ref]);
}
