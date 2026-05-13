"use client";

// Composer for the agent panel. Three responsibilities, kept in one file
// because they share state (textarea value, selected mode):
//   1. Multi-line input with autogrow capped at 128px and Enter-to-send /
//      Shift+Enter-for-newline. The cap matches the panel-height budget
//      reserved for the composer in the App Shell layout spec.
//   2. Mode selection via the `ModeSelector` dropdown.
//   3. A compact + menu for files and explicit context overrides.
//   4. Mic ↔ Send button toggle. When the trimmed input is empty we show
//      the mic affordance (voice input is wired in a later phase); as
//      soon as the user types, the same slot becomes a send button. This
//      avoids two always-visible icons and matches the mockup.
//
// Whitespace-only input is dropped silently (the same `value.trim()`
// check guards both Enter and the send button), and the parent receives
// the trimmed string — never the raw textarea value — so downstream
// chat-thread code never has to re-trim.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  FilePlus,
  FileText,
  Mic,
  Plus,
  Sparkles,
} from "lucide-react";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  filterSlashCommands,
  getAgentCommand,
  parseSlashCommand,
  type AgentCommand,
  type AgentCommandId,
} from "./agent-commands";
import { ModeSelector, type ChatMode } from "./mode-selector";
import type { ActionApprovalMode } from "./context-manifest";
import {
  dataTransferHasProjectTreeNode,
  dataTransferHasFiles,
  readProjectTreeDragPayload,
  type ProjectTreeDragPayload,
} from "@/lib/project-tree-dnd";

interface Props {
  onSend(input: {
    content: string;
    mode: ChatMode;
    command?: AgentCommandId;
  }): void;
  onCommand?(command: AgentCommand): void;
  onAttachFile?(file: File): void;
  onAttachTreeNode?(node: ProjectTreeDragPayload): void;
  activeContextLabel?: string;
  activeContextEnabled?: boolean;
  onToggleActiveContext?(): void;
  actionApprovalMode?: ActionApprovalMode;
  onToggleActionApprovalMode?(): void;
  attachDisabled?: boolean;
  disabled?: boolean;
  focusKey?: number;
}

export function Composer({
  onSend,
  onCommand,
  onAttachFile,
  onAttachTreeNode,
  activeContextLabel,
  activeContextEnabled = true,
  onToggleActiveContext,
  actionApprovalMode = "require",
  onToggleActionApprovalMode,
  attachDisabled,
  disabled,
  focusKey,
}: Props) {
  const t = useTranslations("agentPanel.composer");
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<ChatMode>("auto");
  const [selectedCommand, setSelectedCommand] = useState<AgentCommand | null>(
    null,
  );
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

  useEffect(() => {
    if (focusKey === undefined || disabled) return;
    ref.current?.focus();
  }, [disabled, focusKey]);

  function autoGrow() {
    if (!ref.current) return;
    // Reset to "auto" first so scrollHeight reflects the new content
    // height instead of the previous taller layout — without this the
    // textarea only ever grows, never shrinks.
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.min(128, ref.current.scrollHeight)}px`;
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

  function applyContextCommand(commandId: AgentCommandId) {
    const command = getAgentCommand(commandId);
    if (!command) return;
    onCommand?.(command);
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

    const finalContent =
      content || (command ? resolvePrompt(command) : value.trim());
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
      data-testid="agent-composer"
      className="relative mx-2 mb-2 flex flex-col gap-1 rounded-[var(--radius-control)] border-2 border-border bg-background p-2 transition-colors focus-within:border-foreground"
      onDragOver={(event) => {
        if (
          dataTransferHasFiles(event.dataTransfer) ||
          dataTransferHasProjectTreeNode(event.dataTransfer)
        ) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(event) => {
        const treeNode = readProjectTreeDragPayload(event.dataTransfer);
        if (treeNode) {
          event.preventDefault();
          event.stopPropagation();
          onAttachTreeNode?.(treeNode);
          return;
        }
        if (!dataTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        for (const file of Array.from(event.dataTransfer.files)) {
          onAttachFile?.(file);
        }
      }}
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
        className="min-h-9 resize-none bg-transparent py-1 text-sm leading-5 outline-none placeholder:text-muted-foreground"
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
          className="app-scrollbar-thin absolute bottom-full left-0 right-0 z-20 mb-2 max-h-56 overflow-auto rounded-[var(--radius-card)] border border-border bg-background p-1 text-sm shadow-sm"
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
      <div className="flex h-7 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            aria-label={t("add_menu_aria")}
            disabled={disabled}
            className="rounded-[var(--radius-control)] border border-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={6}
            className="w-52 rounded-[var(--radius-control)] border border-border bg-background p-1 shadow-sm ring-0"
          >
            <DropdownMenuItem
              disabled={attachDisabled || disabled}
              onClick={() => fileInputRef.current?.click()}
              className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5 text-sm hover:bg-muted focus:bg-muted"
            >
              <FilePlus aria-hidden className="h-4 w-4" />
              {t("addMenu.file")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={activeContextEnabled}
              disabled={!activeContextLabel || disabled}
              onCheckedChange={() => onToggleActiveContext?.()}
              className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5 text-sm hover:bg-muted focus:bg-muted"
            >
              <FileText aria-hidden className="h-4 w-4" />
              {t(
                activeContextEnabled
                  ? "addMenu.activeTabOn"
                  : "addMenu.activeTabOff",
              )}
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem
              onClick={() => applyContextCommand("memory_off")}
              className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5 text-sm hover:bg-muted focus:bg-muted"
            >
              <Sparkles aria-hidden className="h-4 w-4" />
              {t("addMenu.memoryOff")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={actionApprovalMode === "auto_safe"}
              disabled={disabled}
              onCheckedChange={() => onToggleActionApprovalMode?.()}
              className="min-h-8 rounded-[var(--radius-control)] px-2 py-1.5 text-sm hover:bg-muted focus:bg-muted"
            >
              <Sparkles aria-hidden className="h-4 w-4" />
              {t(
                actionApprovalMode === "auto_safe"
                  ? "addMenu.autoApplyOn"
                  : "addMenu.autoApplyOff",
              )}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
        <ActionApprovalSelector
          value={actionApprovalMode}
          onToggle={onToggleActionApprovalMode}
          disabled={disabled}
        />
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
            className="ml-1 rounded-[var(--radius-control)] border border-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            <Mic className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function ActionApprovalSelector({
  value,
  onToggle,
  disabled,
}: {
  value: ActionApprovalMode;
  onToggle?: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("agentPanel.composer.actionApproval");
  const options: ActionApprovalMode[] = ["require", "auto_safe"];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        aria-label={t("trigger_aria")}
        disabled={disabled}
        className="inline-flex min-h-7 items-center rounded-[var(--radius-control)] border border-border bg-background px-2.5 py-1 text-xs transition-colors hover:border-foreground hover:bg-muted focus-visible:border-foreground focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
      >
        {t(value)}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-56 rounded-[var(--radius-control)] border border-border bg-background p-1 shadow-sm ring-0"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => {
              if (option !== value) onToggle?.();
            }}
            className={`flex min-h-10 items-start gap-2 rounded-[var(--radius-control)] px-2 py-1.5 text-xs transition-colors hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground ${
              value === option
                ? "bg-muted/60 text-foreground"
                : "text-muted-foreground"
            }`}
          >
            {value === option ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" />
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <span className="min-w-0">
              <span className="block font-medium text-foreground">
                {t(`${option}_label`)}
              </span>
              <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                {t(`${option}_description`)}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
