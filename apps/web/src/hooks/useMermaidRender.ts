"use client";
import { useEffect, useState, useRef } from "react";

// Plan 2D — Lazy mermaid loader + render. Used by both the editor's
// MermaidElement and the chat MermaidChat renderer so visual output
// is identical in both places.
//
// Plan 2E Phase A — Theme reactivity. Mermaid's theme is a global
// `mermaid.initialize` setting; the hook now re-initializes on every
// `theme` change so the next `render` call picks up the new palette.
//
// Mermaid is heavy (~250kB gzipped) and SSR-hostile (touches `window`
// during init), so we never import it eagerly. The first call to this
// hook in the page lifecycle resolves a singleton import promise.

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import("mermaid").then((mod) => mod.default);
  return mermaidPromise;
}

export type MermaidThemeName = "default" | "dark" | "neutral";

/** Map an OpenCairn `Theme` token to the closest Mermaid built-in theme. */
export function mermaidThemeFor(theme: string | undefined | null): MermaidThemeName {
  if (theme === "cairn-dark") return "dark";
  if (theme === "high-contrast") return "neutral";
  return "default";
}

interface UseMermaidResult {
  svg: string | null;
  error: Error | null;
  loading: boolean;
}

export function useMermaidRender(
  code: string,
  theme: MermaidThemeName = "default",
): UseMermaidResult {
  const [state, setState] = useState<UseMermaidResult>({
    svg: null,
    error: null,
    loading: true,
  });
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    let cancelled = false;
    setState({ svg: null, error: null, loading: true });

    if (!code.trim()) {
      setState({ svg: null, error: null, loading: false });
      return;
    }

    loadMermaid()
      .then((m) => {
        m.initialize({
          startOnLoad: false,
          theme,
          securityLevel: "strict",
        });
        return m.render(idRef.current, code);
      })
      .then((res) => {
        if (cancelled) return;
        setState({ svg: res.svg, error: null, loading: false });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          svg: null,
          error: err instanceof Error ? err : new Error("render failed"),
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  return state;
}
