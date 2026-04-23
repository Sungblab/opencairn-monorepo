"use client";

import * as React from "react";
import { ContextMenu as Primitive } from "@base-ui/react/context-menu";

import { cn } from "@/lib/utils";

// Thin shadcn-style wrapper over Base UI's ContextMenu primitive. Mirrors
// the shape of dropdown-menu.tsx so consumers can learn one API.

function ContextMenu({ ...props }: Primitive.Root.Props) {
  return <Primitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({ ...props }: Primitive.Trigger.Props) {
  return <Primitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuContent({
  className,
  ...props
}: Primitive.Popup.Props) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner className="isolate z-50">
        <Primitive.Popup
          data-slot="context-menu-content"
          className={cn(
            "z-50 min-w-40 origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}

function ContextMenuItem({
  className,
  variant = "default",
  ...props
}: Primitive.Item.Props & {
  variant?: "default" | "destructive";
}) {
  return (
    <Primitive.Item
      data-slot="context-menu-item"
      data-variant={variant}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: Primitive.Separator.Props) {
  return (
    <Primitive.Separator
      data-slot="context-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
};
