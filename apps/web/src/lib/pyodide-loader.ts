import type { PyodideInterface } from "pyodide";

export const PYODIDE_VERSION = "0.27.0";
export const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideInterface>;
  }
}

let _instance: Promise<PyodideInterface> | null = null;

export function loadPyodide(): Promise<PyodideInterface> {
  if (_instance) return _instance;

  _instance = (async () => {
    if (!window.loadPyodide) {
      const script = document.createElement("script");
      script.src = `${PYODIDE_CDN}pyodide.js`;
      script.async = true;
      await new Promise<void>((resolve, reject) => {
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load Pyodide script"));
        document.head.appendChild(script);
      });
    }
    if (!window.loadPyodide) {
      throw new Error("window.loadPyodide not injected after script load");
    }
    return window.loadPyodide({ indexURL: PYODIDE_CDN });
  })();

  return _instance;
}
