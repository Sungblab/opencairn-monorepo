"use client";
import {
  AlertOctagon,
  AlertTriangle,
  Info,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEditorRef } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import type { Descendant } from "platejs";
import { proseClasses, type CalloutKind } from "@/lib/markdown/shared-prose";

const ICONS: Record<CalloutKind, LucideIcon> = {
  info: Info,
  warn: AlertTriangle,
  tip: Lightbulb,
  danger: AlertOctagon,
};

const CYCLE: CalloutKind[] = ["info", "warn", "tip", "danger"];

interface CalloutElementProps extends Omit<PlateElementProps, "element"> {
  element: PlateElementProps["element"] & {
    type: "callout";
    kind: CalloutKind;
    children: Descendant[];
  };
}

export function CalloutElement({
  attributes,
  children,
  element,
}: CalloutElementProps) {
  const t = useTranslations("editor.blocks.callout");
  const editor = useEditorRef();
  const Icon = ICONS[element.kind];

  const cycle = () => {
    const idx = CYCLE.indexOf(element.kind);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    const path = editor.api.findPath(element as never);
    editor.tf.setNodes({ kind: next }, { at: path });
  };

  return (
    <div
      {...attributes}
      className={`my-2 flex gap-2 rounded p-3 ${proseClasses.calloutBorder[element.kind]}`}
      data-testid={`callout-${element.kind}`}
    >
      <button
        type="button"
        contentEditable={false}
        onMouseDown={(e) => {
          // Prevent selection loss before mutating.
          e.preventDefault();
          cycle();
        }}
        aria-label={t(element.kind)}
        data-testid="callout-kind-button"
        data-kind={element.kind}
        className="mt-0.5 shrink-0 hover:opacity-70"
      >
        <Icon className="h-4 w-4" />
      </button>
      <div className="flex-1">{children}</div>
    </div>
  );
}
