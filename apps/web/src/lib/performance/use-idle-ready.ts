"use client";

import { useEffect, useState } from "react";

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

interface UseIdleReadyOptions {
  timeout: number;
  fallbackMs: number;
}

export function useIdleReady({ timeout, fallbackMs }: UseIdleReadyOptions) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const win = window as IdleWindow;
    let cancelled = false;
    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    if (win.requestIdleCallback) {
      const handle = win.requestIdleCallback(markReady, { timeout });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(handle);
      };
    }

    const handle = window.setTimeout(markReady, fallbackMs);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [fallbackMs, timeout]);

  return ready;
}
