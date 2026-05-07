"use client";
import { ChevronRight } from "lucide-react";
import { useEditorRef } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import type { Descendant } from "platejs";
import { Children, type ReactNode } from "react";

interface ToggleElementProps extends Omit<PlateElementProps, "element"> {
  element: PlateElementProps["element"] & {
    type: "toggle";
    open?: boolean;
    children: Descendant[];
  };
}

export function ToggleElement({
  attributes,
  children,
  element,
}: ToggleElementProps) {
  const editor = useEditorRef();
  const isOpen = element.open ?? false;

  const toggle = () => {
    const path = editor.api.findPath(element as never);
    if (path) editor.tf.setNodes({ open: !isOpen }, { at: path });
  };

  // Slate requires non-void elements to render every child node, otherwise
  // selection/normalization/undo break. We split summary vs body and CSS-hide
  // the body when collapsed instead of conditionally rendering it.
  const childArray = Children.toArray(children) as ReactNode[];
  const [summary, ...body] = childArray;

  return (
    <div {...attributes} className="my-1 group" data-testid="toggle-block">
      <div className="flex items-start gap-1">
        <button
          type="button"
          contentEditable={false}
          onPointerDown={(e) => {
            e.preventDefault();
            toggle();
          }}
          data-testid="toggle-chevron"
          aria-expanded={isOpen}
          className="mt-1 shrink-0 hover:bg-[color:var(--bg-muted)] rounded p-0.5"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 transition-transform ${
              isOpen ? "rotate-90" : ""
            }`}
          />
        </button>
        <div className="flex-1">{summary}</div>
      </div>
      <div
        data-testid="toggle-body"
        data-open={isOpen}
        className="ml-5 border-l border-[color:var(--border)] pl-3 mt-1"
        style={{ display: isOpen ? undefined : "none" }}
      >
        {body}
      </div>
    </div>
  );
}
