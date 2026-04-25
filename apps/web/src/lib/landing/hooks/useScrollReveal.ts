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
    let io: IntersectionObserver | null = null;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        io = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (e.isIntersecting) {
                (e.target as HTMLElement).classList.add("in");
                io?.unobserve(e.target);
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

    // bfcache 복원 핸들러: 동결 중에는 useEffect가 재실행되지 않으므로 IO가 살아있어도
    // 새 스크롤 위치에 대해 발화 못 할 수 있다. viewport 안 또는 위에 있는 reveal
    // 요소를 transition 없이 즉시 표시해 "빈 화면" 회귀를 막는다.
    const onPageshow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      for (const el of targets) {
        if (el.classList.contains("in")) continue;
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight) {
          const prev = el.style.transition;
          el.style.transition = "none";
          el.classList.add("in");
          void el.offsetHeight;
          el.style.transition = prev;
        }
      }
    };
    window.addEventListener("pageshow", onPageshow);

    return () => {
      cancelled = true;
      io?.disconnect();
      window.removeEventListener("pageshow", onPageshow);
    };
  }, [ref]);
}
