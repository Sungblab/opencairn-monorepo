"use client";

import type {
  AnnotationCapability,
  PluginRegistry,
} from "@embedpdf/react-pdf-viewer";
import { Highlighter, MousePointer2, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AnnotationProvider = {
  provides(): Readonly<AnnotationCapability>;
};

function getAnnotationCapability(
  registry: PluginRegistry | null,
): Readonly<AnnotationCapability> | null {
  if (!registry) return null;
  if (typeof registry.getCapabilityProvider !== "function") return null;
  const provider = registry.getCapabilityProvider(
    "annotation",
  ) as AnnotationProvider | null;
  return provider?.provides() ?? null;
}

type DrawingTool = "move" | "ink" | "inkHighlighter";

export function PdfDrawingToolbar({
  registry,
  className,
  floating = false,
}: {
  registry: PluginRegistry | null;
  className?: string;
  floating?: boolean;
}) {
  const t = useTranslations("appShell.viewers.source.drawing");
  const [activeTool, setActiveTool] = useState<DrawingTool>("move");
  const capability = getAnnotationCapability(registry);
  const disabled = !capability;

  const activate = (tool: DrawingTool) => {
    if (!capability) return;
    if (tool === "move") {
      capability.setActiveTool(null);
    } else {
      capability.setActiveTool(tool);
    }
    setActiveTool(tool);
  };

  return (
    <div
      className={cn(
        floating
          ? "absolute left-3 top-16 z-20 flex flex-col items-center gap-1 rounded-md border bg-background/95 p-1 text-foreground shadow-md backdrop-blur"
          : "flex min-h-10 items-center gap-1 border-b bg-background px-2 py-1 text-foreground",
        className,
      )}
      aria-label={t("label")}
      aria-orientation={floating ? "vertical" : "horizontal"}
    >
      <ToolButton
        active={activeTool === "move"}
        disabled={disabled}
        label={t("move")}
        onClick={() => activate("move")}
      >
        <MousePointer2 className="h-4 w-4" aria-hidden />
      </ToolButton>
      <ToolButton
        active={activeTool === "ink"}
        disabled={disabled}
        label={t("pen")}
        onClick={() => activate("ink")}
      >
        <PenLine className="h-4 w-4" aria-hidden />
      </ToolButton>
      <ToolButton
        active={activeTool === "inkHighlighter"}
        disabled={disabled}
        label={t("highlighter")}
        onClick={() => activate("inkHighlighter")}
      >
        <Highlighter className="h-4 w-4" aria-hidden />
      </ToolButton>
      {!floating ? (
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
          {activeTool === "ink"
            ? t("hintPen")
            : activeTool === "inkHighlighter"
              ? t("hintHighlighter")
              : t("hintMove")}
        </span>
      ) : null}
    </div>
  );
}

function ToolButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "default" : "ghost"}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className="h-8 w-8 p-0"
    >
      {children}
    </Button>
  );
}
