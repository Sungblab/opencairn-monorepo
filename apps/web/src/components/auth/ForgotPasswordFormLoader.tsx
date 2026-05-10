"use client";

import dynamic from "next/dynamic";

const LazyForgotPasswordForm = dynamic(
  () =>
    import("./ForgotPasswordForm").then((mod) => mod.ForgotPasswordForm),
  {
    ssr: false,
    loading: () => <ForgotPasswordFormSkeleton />,
  },
);

export function ForgotPasswordFormLoader() {
  return <LazyForgotPasswordForm />;
}

function ForgotPasswordFormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded bg-stone-200" />
        <div className="h-5 w-80 max-w-full animate-pulse rounded bg-stone-100" />
        <div className="h-12 animate-pulse rounded-md bg-stone-100" />
        <div className="h-12 animate-pulse rounded-md bg-stone-200" />
      </div>
    </div>
  );
}
