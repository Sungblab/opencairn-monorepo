import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

// Two parallel projects so node-only logic (utils, parsers) stays fast and
// hook/component tests can opt into jsdom without dragging the rest into
// a heavy DOM. App Shell Phase 1 introduces the jsdom project for the
// `useBreakpoint`, `useKeyboardShortcut`, and `useUrlTabSync` suites.
//
// `@vitejs/plugin-react` is required because Next.js sets tsconfig
// `jsx: preserve` (Next does its own transform) — vite would otherwise
// trip over JSX in `.test.tsx` files.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test-setup.ts"],
        },
      },
    ],
  },
});
