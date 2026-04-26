"use client";
import { useEffect, useState, useRef } from "react";

// Plan 2D — Lazy mermaid loader + render. Used by both the editor's
// MermaidElement and the chat MermaidChat renderer so visual output
// is identical in both places.
//
// Mermaid is heavy (~250kB gzipped) and SSR-hostile (touches `window`
// during init), so we never import it eagerly. The first call to this
// hook in the page lifecycle resolves a singleton import promise.

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import("mermaid").then((mod) => {
    const m = mod.default;
    m.initialize({
      startOnLoad: false,
      theme:
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark")
          ? "dark"
          : "default",
      securityLevel: "strict",
    });
    return m;
  });
  return mermaidPromise;
}

interface UseMermaidResult {
  svg: string | null;
  error: Error | null;
  loading: boolean;
}

export function useMermaidRender(code: string): UseMermaidResult {
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
      .then((m) => m.render(idRef.current, code))
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
  }, [code]);

  return state;
}
