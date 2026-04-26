"use client";

export function StreamingCursor() {
  return (
    <span
      data-testid="streaming-cursor"
      aria-hidden="true"
      className="ml-0.5 inline-block w-[2px] h-4 align-middle animate-pulse bg-[color:var(--fg-base)]"
    />
  );
}
