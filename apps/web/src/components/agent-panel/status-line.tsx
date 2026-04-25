"use client";

// Pulsing-dot status row shown while the agent is mid-stream (e.g. "관련 문서
// 훑는 중"). The phrase itself is sourced from the SSE pipeline as a free
// string — we treat it as already-localised display content, so this wrapper
// has nothing of its own to translate.

export function StatusLine({ phrase }: { phrase: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-foreground/40" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-foreground" />
      </span>
      <span>{phrase}</span>
    </div>
  );
}
