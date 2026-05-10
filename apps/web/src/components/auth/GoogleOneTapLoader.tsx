"use client";

import dynamic from "next/dynamic";

const LazyGoogleOneTap = dynamic(
  () => import("./GoogleOneTap").then((mod) => mod.GoogleOneTap),
  {
    ssr: false,
    loading: () => null,
  },
);

export function GoogleOneTapLoader() {
  return <LazyGoogleOneTap />;
}
