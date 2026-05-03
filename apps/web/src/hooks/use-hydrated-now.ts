"use client";

import { useEffect, useState } from "react";

export function useHydratedNow() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  return now;
}
