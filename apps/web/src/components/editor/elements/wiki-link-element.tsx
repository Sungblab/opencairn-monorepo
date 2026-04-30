"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { PlateElementProps } from "platejs/react";

// Inline wiki-link node. Non-void — Slate keeps a zero-width text child for
// selection bookkeeping (the `{ text: "" }` placeholder emitted at insert
// time), so `children` must be rendered inside the anchor. Without it, Slate
// throws "Cannot get the start point of the node at path ... because it has no
// ranges".
//
// Context (wsSlug/projectId) comes from the plugin factory via plugin options
// — read through `useEditorPluginOption`. Rendering through `next/link`
// means internal navigation stays client-side; opening in a new tab still
// works via middle-click / ctrl-click because `next/link` renders a real `<a>`.
export interface WikiLinkElement {
  type: "wiki-link";
  targetId: string;
  title: string;
  /** Set by the tombstone sweep when the target note is soft-deleted. */
  deleted?: boolean;
  children: [{ text: "" }];
}

export interface WikiLinkContext {
  wsSlug: string;
  projectId: string;
}

export function WikiLinkElement({
  attributes,
  children,
  element,
  wsSlug,
  projectId,
}: PlateElementProps & WikiLinkContext) {
  const t = useTranslations("editor.wikilink");
  const locale = useLocale();
  const el = element as unknown as WikiLinkElement;
  const { targetId, title, deleted } = el;

  if (deleted) {
    return (
      <span
        {...attributes}
        className="text-fg-muted line-through"
        title={t("deleted")}
        data-target-id={targetId}
        data-deleted="true"
      >
        {title}
        {children}
      </span>
    );
  }

  return (
    <Link
      {...attributes}
      href={`/${locale}/app/w/${wsSlug}/n/${targetId}`}
      className="text-[color:var(--accent-ember)] underline underline-offset-2 hover:opacity-80"
      data-target-id={targetId}
    >
      {title}
      {children}
    </Link>
  );
}
