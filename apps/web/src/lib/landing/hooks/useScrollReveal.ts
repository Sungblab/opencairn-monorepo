"use client";
import { type RefObject } from "react";

/**
 * No-op compatibility shim. Reveal animations are now driven entirely by CSS
 * (`animation-timeline: view()` for in-viewport sections, `.reveal-intro` for
 * Hero) — see `apps/web/src/app/globals.css`. This hook is preserved only so
 * existing call sites in landing components don't need to change.
 *
 * The CSS-first approach is robust against browser bfcache restoration and
 * Next.js 16 SPA back-nav, where useEffect-driven `.in` toggling was leaving
 * elements stuck at opacity:0.
 */
export function useScrollReveal(_ref: RefObject<HTMLElement | null>) {
  // intentionally empty — see jsdoc above
}
