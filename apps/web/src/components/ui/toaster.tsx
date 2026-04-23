"use client";
import { Toaster as SonnerToaster } from "sonner";
import { useTheme } from "@/lib/theme/provider";

// Bridge the app's four-palette theme (`cairn-light`/`cairn-dark`/`sepia`/
// `high-contrast`) to sonner's binary light/dark switch — only cairn-dark is
// the dark variant, everything else reads from the light design tokens.
// Toast visuals inherit CSS vars from the root `data-theme` attribute via
// the `--normal-*` mappings below, so palette changes propagate automatically
// without the Toaster re-mounting.
export function Toaster() {
  const { theme } = useTheme();
  const mode = theme === "cairn-dark" ? "dark" : "light";
  return (
    <SonnerToaster
      theme={mode}
      position="bottom-right"
      closeButton
      richColors={false}
      toastOptions={{
        style: {
          background: "var(--color-popover)",
          color: "var(--color-popover-foreground)",
          border: "1px solid var(--color-border)",
        },
      }}
    />
  );
}
