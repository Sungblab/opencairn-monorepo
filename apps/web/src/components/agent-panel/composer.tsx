"use client";

// Composer for the agent panel. Three responsibilities, kept in one file
// because they share state (textarea value, selected mode):
//   1. Multi-line input with autogrow capped at 200px and Enter-to-send /
//      Shift+Enter-for-newline. The cap matches the panel-height budget
//      reserved for the composer in the App Shell layout spec.
//   2. Mode selection via the `ModeSelector` dropdown.
//   3. Mic ↔ Send button toggle. When the trimmed input is empty we show
//      the mic affordance (voice input is wired in a later phase); as
//      soon as the user types, the same slot becomes a send button. This
//      avoids two always-visible icons and matches the mockup.
//
// Whitespace-only input is dropped silently (the same `value.trim()`
// check guards both Enter and the send button), and the parent receives
// the trimmed string — never the raw textarea value — so downstream
// chat-thread code never has to re-trim.

import { useRef, useState } from "react";
import { ArrowUp, Mic, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";

import { ModeSelector, type ChatMode } from "./mode-selector";

interface Props {
  onSend(input: { content: string; mode: ChatMode }): void;
  disabled?: boolean;
}

export function Composer({ onSend, disabled }: Props) {
  const t = useTranslations("agentPanel.composer");
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<ChatMode>("auto");
  const ref = useRef<HTMLTextAreaElement>(null);

  function autoGrow() {
    if (!ref.current) return;
    // Reset to "auto" first so scrollHeight reflects the new content
    // height instead of the previous taller layout — without this the
    // textarea only ever grows, never shrinks.
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.min(200, ref.current.scrollHeight)}px`;
  }

  function submit() {
    if (!value.trim() || disabled) return;
    onSend({ content: value.trim(), mode });
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  }

  const hasText = value.trim().length > 0;

  return (
    <div
      className="mx-3 mb-3 flex flex-col gap-1 rounded-[var(--radius-control)] border-2 border-border bg-background p-2 transition-colors focus-within:border-foreground"
    >
      <textarea
        aria-label={t("input_aria")}
        ref={ref}
        rows={1}
        value={value}
        placeholder={t("placeholder")}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          autoGrow();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-14 resize-none bg-transparent py-1.5 text-sm leading-5 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t("attach_aria")}
          className="rounded-[var(--radius-control)] border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <div className="flex-1" />
        <ModeSelector value={mode} onChange={setMode} />
        {hasText ? (
          <button
            type="button"
            aria-label={t("send_aria")}
            onClick={submit}
            disabled={disabled}
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-foreground bg-foreground text-background disabled:opacity-50"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t("voice_aria")}
            className="ml-1 rounded-[var(--radius-control)] border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
