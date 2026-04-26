"use client";
import { Children, isValidElement, type ReactNode } from "react";
import { Info, AlertTriangle, Lightbulb, AlertOctagon } from "lucide-react";
import { proseClasses, type CalloutKind } from "@/lib/markdown/shared-prose";

const ICONS = {
  info: Info,
  warn: AlertTriangle,
  tip: Lightbulb,
  danger: AlertOctagon,
} as const;

const PREFIX_RE = /^\s*\[!(\w+)\]\s?(.*)$/s;

function detectKind(children: ReactNode): {
  kind: CalloutKind;
  withoutPrefix: ReactNode[];
} | null {
  const arr = Children.toArray(children);
  // The first element is usually a <p> wrapping the body. Inspect its first
  // text child for the [!kind] sentinel.
  // Skip leading whitespace-only text nodes that react-markdown may inject
  // between the <blockquote> open tag and the first <p>.
  const firstIdx = arr.findIndex(
    (node) => isValidElement(node) || (typeof node === "string" && node.trim() !== ""),
  );
  if (firstIdx === -1) return null;
  const first = arr[firstIdx];
  if (!isValidElement(first)) return null;
  const innerArr = Children.toArray((first.props as { children?: ReactNode }).children ?? []);
  const firstInner = innerArr[0];
  if (typeof firstInner !== "string") return null;
  const match = firstInner.match(PREFIX_RE);
  if (!match) return null;

  const rawKind = match[1].toLowerCase();
  const validKinds: CalloutKind[] = ["info", "warn", "tip", "danger"];
  const kind: CalloutKind = (validKinds as string[]).includes(rawKind)
    ? (rawKind as CalloutKind)
    : "info";
  const remaining = match[2];

  // Reconstruct the first <p> with prefix stripped, preserving any inline children
  // that came after the leading text (links, code marks, etc.).
  const newInner: ReactNode[] = [remaining, ...innerArr.slice(1)];
  const newFirst = isValidElement(first)
    ? { ...first, props: { ...(first.props as object), children: newInner } }
    : first;
  return { kind, withoutPrefix: [newFirst, ...arr.slice(firstIdx + 1)] };
}

interface CalloutBlockquoteProps {
  children?: ReactNode;
}

export function CalloutBlockquote({ children }: CalloutBlockquoteProps) {
  const detected = detectKind(children);
  if (!detected) {
    return <blockquote className={proseClasses.blockquote}>{children}</blockquote>;
  }
  const { kind, withoutPrefix } = detected;
  const Icon = ICONS[kind];
  return (
    <div
      data-testid={`chat-callout-${kind}`}
      className={`my-2 flex gap-2 rounded p-3 ${proseClasses.calloutBorder[kind]}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 [&>p:first-child]:mt-0 [&>p:last-child]:mb-0">
        {withoutPrefix}
      </div>
    </div>
  );
}
