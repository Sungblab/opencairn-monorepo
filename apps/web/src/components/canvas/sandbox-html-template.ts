// Renders the HTML string written into a Blob URL → iframe sandbox.
// All runtime CDN URLs are version-pinned (esm.sh react@19) so a CDN drift
// can't silently change the React major. CI grep guard (Task 17) blocks
// `latest` / unpinned tags from regressing.
//
// Why three modes:
// - "html": user wrote HTML; render as-is.
// - "javascript": wrap user JS in a module script; provide a `#root` mount.
// - "react": same `#root`, but bring React via esm.sh import map and call
//   `createRoot(...)` on whatever default-exported component the user wrote.
//   The default-export-vs-globalThis.App probe lets either ESM-style
//   `export default` or imperative `globalThis.App = ...` work in the
//   inline module.

export type CanvasIframeLanguage = "react" | "html" | "javascript";

export function buildSandboxHTML(
  userSource: string,
  language: CanvasIframeLanguage,
): string {
  if (language === "html") {
    return userSource;
  }

  if (language === "javascript") {
    return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body>
  <div id="root"></div>
  <script type="module">
${userSource}
  </script>
</body></html>`;
  }

  // react
  return `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <script type="importmap">
    {
      "imports": {
        "react": "https://esm.sh/react@19",
        "react-dom/client": "https://esm.sh/react-dom@19/client"
      }
    }
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "react";
    import { createRoot } from "react-dom/client";
${userSource}
    const App = (typeof default_1 !== "undefined") ? default_1 : (typeof globalThis.App !== "undefined" ? globalThis.App : null);
    if (App) {
      createRoot(document.getElementById("root")).render(React.createElement(App));
    } else {
      document.getElementById("root").textContent = "No default export found";
    }
  </script>
</body></html>`;
}
