"use client";

import { useEffect, useState } from "react";

function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/i.test(navigator.platform);
}

export function useModKeyLabel() {
  const [label, setLabel] = useState("Ctrl");

  useEffect(() => {
    setLabel(detectMac() ? "⌘" : "Ctrl");
  }, []);

  return label;
}
