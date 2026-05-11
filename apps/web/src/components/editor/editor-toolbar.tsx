"use client";

import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  MessageSquareWarning,
  Quote,
  Sigma,
  Strikethrough,
  Table2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type React from "react";

import { Button } from "@/components/ui/button";

export type ToolbarMark = "bold" | "italic" | "strikethrough" | "code";
export type ToolbarBlock = "h1" | "h2" | "h3" | "ul" | "ol" | "blockquote";
export type ToolbarInsertBlock = "math" | "table" | "callout";

export interface ToolbarActions {
  toggleMark: (mark: ToolbarMark) => void;
  toggleBlock: (type: ToolbarBlock) => void;
  insertBlock: (type: ToolbarInsertBlock) => void;
}

export function EditorToolbar({ actions }: { actions: ToolbarActions }) {
  const t = useTranslations("editor.toolbar");

  return (
    <div
      role="toolbar"
      aria-label={t("aria_label")}
      className="app-scrollbar-thin sticky top-12 z-10 flex min-h-10 items-center gap-0.5 overflow-x-auto border-b border-border bg-background/90 px-4 py-1 backdrop-blur"
    >
      <IconBtn label={t("bold")} onClick={() => actions.toggleMark("bold")}>
        <Bold className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("italic")} onClick={() => actions.toggleMark("italic")}>
        <Italic className="h-4 w-4" />
      </IconBtn>
      <IconBtn
        label={t("strike")}
        onClick={() => actions.toggleMark("strikethrough")}
      >
        <Strikethrough className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("code")} onClick={() => actions.toggleMark("code")}>
        <Code className="h-4 w-4" />
      </IconBtn>
      <Divider />
      <IconBtn label={t("h1")} onClick={() => actions.toggleBlock("h1")}>
        <Heading1 className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("h2")} onClick={() => actions.toggleBlock("h2")}>
        <Heading2 className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("h3")} onClick={() => actions.toggleBlock("h3")}>
        <Heading3 className="h-4 w-4" />
      </IconBtn>
      <Divider />
      <IconBtn label={t("bulleted")} onClick={() => actions.toggleBlock("ul")}>
        <List className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("numbered")} onClick={() => actions.toggleBlock("ol")}>
        <ListOrdered className="h-4 w-4" />
      </IconBtn>
      <IconBtn
        label={t("quote")}
        onClick={() => actions.toggleBlock("blockquote")}
      >
        <Quote className="h-4 w-4" />
      </IconBtn>
      <Divider />
      <IconBtn label={t("math")} onClick={() => actions.insertBlock("math")}>
        <Sigma className="h-4 w-4" />
      </IconBtn>
      <IconBtn label={t("table")} onClick={() => actions.insertBlock("table")}>
        <Table2 className="h-4 w-4" />
      </IconBtn>
      <IconBtn
        label={t("callout")}
        onClick={() => actions.insertBlock("callout")}
      >
        <MessageSquareWarning className="h-4 w-4" />
      </IconBtn>
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1.5 h-5 w-px bg-border" />;
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
    >
      {children}
    </Button>
  );
}
