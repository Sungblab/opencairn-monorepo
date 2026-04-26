"use client";
import { ChevronRight } from "lucide-react";
import { useEditorRef } from "platejs/react";
import type { PlateElementProps } from "platejs/react";
import type { Descendant } from "platejs";
import { Children, isValidElement, type ReactNode } from "react";

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
    editor.tf.setNodes({ open: !isOpen }, { at: path });
  };

  // Slate passes one child per element child as a React element. The first
  // entry is the summary, the rest are the body. Splitting via Children.toArray
  // keeps Slate's selection wiring intact (we never render outside `children`).
  const childArray = Children.toArray(children) as ReactNode[];
  const [summary, ...body] = childArray;

  return (
    <div {...attributes} className="my-1 group" data-testid="toggle-block">
      <div className="flex items-start gap-1">
        <button
          type="button"
          contentEditable={false}
          onMouseDown={(e) => {
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
      {isOpen && body.length > 0 && (
        <div data-testid="toggle-body" className="ml-5 border-l border-[color:var(--border)] pl-3 mt-1">
          {body.map((child, i) =>
            isValidElement(child) ? <div key={i}>{child}</div> : child,
          )}
        </div>
      )}
    </div>
  );
}
