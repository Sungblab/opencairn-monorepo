"use client";

import dynamic from "next/dynamic";

const LazyLoginForm = dynamic(
  () => import("./LoginForm").then((mod) => mod.LoginForm),
  {
    ssr: false,
    loading: () => <AuthFormSkeleton steps={2} />,
  },
);

export function LoginFormLoader() {
  return <LazyLoginForm />;
}

function AuthFormSkeleton({ steps }: { steps: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex gap-2">
        {Array.from({ length: steps }).map((_, index) => (
          <div
            key={index}
            className="h-1 flex-1 animate-pulse rounded-full bg-stone-200"
          />
        ))}
      </div>
      <div className="space-y-3">
        <div className="h-8 w-56 animate-pulse rounded bg-stone-200" />
        <div className="h-12 animate-pulse rounded-md bg-stone-100" />
        <div className="h-12 animate-pulse rounded-md bg-stone-100" />
      </div>
    </div>
  );
}
