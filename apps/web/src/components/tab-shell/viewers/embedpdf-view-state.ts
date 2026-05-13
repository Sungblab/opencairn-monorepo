"use client";

import { useEffect } from "react";
import type { PluginRegistry } from "@embedpdf/react-pdf-viewer";

type PageChangeEvent = {
  pageNumber?: number;
};

type ScrollCapability = {
  scrollToPage(options: { pageNumber: number; behavior?: "instant" | "smooth" | "auto" }): void;
  onPageChange(listener: (event: PageChangeEvent) => void): () => void;
};

type ScrollProvider = {
  provides(): Readonly<ScrollCapability>;
};

export function pdfViewStateKey(scope: "source" | "agent-file", id: string) {
  return `oc:pdf-view:${scope}:${id}`;
}

function readPageNumber(storageKey: string): number | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { pageNumber?: unknown };
    return typeof parsed.pageNumber === "number" && parsed.pageNumber > 0
      ? parsed.pageNumber
      : null;
  } catch {
    return null;
  }
}

function writePageNumber(storageKey: string, pageNumber: number) {
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ pageNumber, updatedAt: Date.now() }),
    );
  } catch {
    // Ignore private browsing or quota failures; PDF viewing should still work.
  }
}

function getScrollCapability(
  registry: PluginRegistry,
): Readonly<ScrollCapability> | null {
  if (typeof registry.getCapabilityProvider !== "function") return null;
  const provider = registry.getCapabilityProvider("scroll") as ScrollProvider | null;
  return provider?.provides() ?? null;
}

export function useEmbedPdfPagePersistence(
  storageKey: string | null,
  registry: PluginRegistry | null,
) {
  useEffect(() => {
    if (!storageKey || !registry || typeof window === "undefined") return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const setup = async () => {
      if (typeof registry.pluginsReady === "function") {
        await registry.pluginsReady();
      }
      if (cancelled) return;
      const capability = getScrollCapability(registry);
      if (!capability) return;

      const savedPage = readPageNumber(storageKey);
      if (savedPage) {
        capability.scrollToPage({ pageNumber: savedPage, behavior: "instant" });
      }

      unsubscribe = capability.onPageChange((event) => {
        if (typeof event.pageNumber === "number" && event.pageNumber > 0) {
          writePageNumber(storageKey, event.pageNumber);
        }
      });
    };

    void setup().catch(() => undefined);

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [registry, storageKey]);
}
