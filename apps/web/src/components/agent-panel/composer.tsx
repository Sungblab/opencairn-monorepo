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

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Mic, Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  filterSlashCommands,
  parseSlashCommand,
  type AgentCommand,
  type AgentCommandId,
} from "./agent-commands";
import { ModeSelector, type ChatMode } from "./mode-selector";

interface Props {
  onSend(input: {
    content: string;
    mode: ChatMode;
    command?: AgentCommandId;
  }): void;
  onCommand?(command: AgentCommand): void;
  onAttachFile?(file: File): void;
  attachDisabled?: boolean;
  disabled?: boolean;
}

export function Composer({
  onSend,
  onCommand,
  onAttachFile,
  attachDisabled,
  disabled,
}: Props) {
  const t = useTranslations("agentPanel.composer");
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<ChatMode>("auto");
  const [selectedCommand, setSelectedCommand] = useState<AgentCommand | null>(null);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slashInput = value.trimStart();
  const normalizedSlashInput = slashInput.normalize("NFKC");
  const slashOpen = normalizedSlashInput.startsWith("/");
  const slashTokenOnly = slashOpen && !/\s/.test(slashInput);
  const slashQuery = slashOpen
    ? Array.from(normalizedSlashInput).slice(1).join("")
    : "";
  const slashCommands = useMemo(
    () => (slashOpen ? filterSlashCommands(slashQuery) : []),
    [slashOpen, slashQuery],
  );

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [slashQuery, slashCommands.length]);

  function autoGrow() {
    if (!ref.current) return;
    // Reset to "auto" first so scrollHeight reflects the new content
    // height instead of the previous taller layout — without this the
    // textarea only ever grows, never shrinks.
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.min(200, ref.current.scrollHeight)}px`;
  }

  function resetComposer() {
    setValue("");
    setSelectedCommand(null);
    if (ref.current) ref.current.style.height = "auto";
  }

  function resolvePrompt(command: AgentCommand) {
    return t(`slash.prompt.${command.promptKey}`);
  }

  function chooseCommand(command: AgentCommand) {
    if (command.effect === "context") {
      onCommand?.(command);
      resetComposer();
      return;
    }
    setSelectedCommand(command);
    setValue("");
    ref.current?.focus();
  }

  function submit() {
    if ((!value.trim() && !selectedCommand) || disabled) return;
    const parsed = parseSlashCommand(value);
    const command = selectedCommand ?? parsed?.command ?? null;
    const content = parsed ? parsed.content : value.trim();

    if (command?.effect === "context") {
      onCommand?.(command);
      if (!content) {
        resetComposer();
        return;
      }
    }

    const finalContent = content || (command ? resolvePrompt(command) : value.trim());
    if (!finalContent) return;
    onSend({
      content: finalContent,
      mode: command?.mode ?? mode,
      ...(command ? { command: command.id } : {}),
    });
    resetComposer();
  }

  const hasText = value.trim().length > 0 || Boolean(selectedCommand);

  return (
    <div
      className="relative mx-3 mb-3 flex flex-col gap-1 rounded-[var(--radius-control)] border-2 border-border bg-background p-2 transition-colors focus-within:border-foreground"
    >
      {selectedCommand ? (
        <div className="inline-flex w-fit items-center gap-1 rounded-[var(--radius-control)] border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
          <span>{selectedCommand.aliases[0]}</span>
          <span>{t(`slash.command.${selectedCommand.id}`)}</span>
        </div>
      ) : null}
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
          if (slashOpen && e.key === "ArrowDown") {
            e.preventDefault();
            setActiveCommandIndex((current) =>
              slashCommands.length === 0
                ? 0
                : (current + 1) % slashCommands.length,
            );
            return;
          }
          if (slashOpen && e.key === "ArrowUp") {
            e.preventDefault();
            setActiveCommandIndex((current) =>
              slashCommands.length === 0
                ? 0
                : (current - 1 + slashCommands.length) % slashCommands.length,
            );
            return;
          }
          if (slashOpen && e.key === "Escape") {
            e.preventDefault();
            resetComposer();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (slashTokenOnly && slashCommands[activeCommandIndex]) {
              chooseCommand(slashCommands[activeCommandIndex]);
              return;
            }
            submit();
          }
        }}
        className="min-h-14 resize-none bg-transparent py-1.5 text-sm leading-5 outline-none placeholder:text-muted-foreground"
      />
      {slashOpen ? (
        <div
          role="listbox"
          aria-label={t("slash.menu_aria")}
          aria-activedescendant={
            slashCommands[activeCommandIndex]
              ? `agent-command-${slashCommands[activeCommandIndex].id}`
              : undefined
          }
          className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-56 overflow-auto rounded-[var(--radius-card)] border border-border bg-background p-1 text-sm shadow-sm"
        >
          {slashCommands.map((command, index) => (
            <button
              key={command.id}
              id={`agent-command-${command.id}`}
              type="button"
              role="option"
              aria-selected={index === activeCommandIndex}
              className={`app-hover flex w-full items-center gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-left ${
                index === activeCommandIndex ? "bg-muted text-foreground" : ""
              }`}
              onMouseEnter={() => setActiveCommandIndex(index)}
              onClick={() => chooseCommand(command)}
            >
              <span className="w-24 shrink-0 font-medium text-foreground">
                {command.aliases[0]}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {t(`slash.command.${command.id}`)}
              </span>
            </button>
          ))}
          {slashCommands.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("slash.empty")}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t("attach_aria")}
          className="rounded-[var(--radius-control)] border border-transparent p-1.5 text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50"
          disabled={attachDisabled || disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          ref={fileInputRef}
          data-testid="agent-composer-file-input"
          type="file"
          className="hidden"
          multiple
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            for (const file of files) onAttachFile?.(file);
            event.currentTarget.value = "";
          }}
        />
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
