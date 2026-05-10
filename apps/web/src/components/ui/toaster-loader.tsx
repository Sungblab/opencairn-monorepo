"use client";

import dynamic from "next/dynamic";
import { useIdleReady } from "@/lib/performance/use-idle-ready";

const Toaster = dynamic(() => import("./toaster").then((mod) => mod.Toaster), {
  ssr: false,
});

export function ToasterLoader() {
  const ready = useIdleReady({ timeout: 2000, fallbackMs: 1000 });

  return ready ? <Toaster /> : null;
}
