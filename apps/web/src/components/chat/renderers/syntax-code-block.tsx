"use client";

import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import diff from "react-syntax-highlighter/dist/esm/languages/prism/diff";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

const languageAliases: Record<string, string> = {
  html: "markup",
  js: "javascript",
  md: "markdown",
  ps1: "powershell",
  py: "python",
  shell: "bash",
  sh: "bash",
  ts: "typescript",
  yml: "yaml",
  xml: "markup",
};

let languagesRegistered = false;

function ensureLanguagesRegistered() {
  if (languagesRegistered) return;
  SyntaxHighlighter.registerLanguage("bash", bash);
  SyntaxHighlighter.registerLanguage("css", css);
  SyntaxHighlighter.registerLanguage("diff", diff);
  SyntaxHighlighter.registerLanguage("javascript", javascript);
  SyntaxHighlighter.registerLanguage("json", json);
  SyntaxHighlighter.registerLanguage("jsx", jsx);
  SyntaxHighlighter.registerLanguage("markdown", markdown);
  SyntaxHighlighter.registerLanguage("markup", markup);
  SyntaxHighlighter.registerLanguage("powershell", powershell);
  SyntaxHighlighter.registerLanguage("python", python);
  SyntaxHighlighter.registerLanguage("sql", sql);
  SyntaxHighlighter.registerLanguage("tsx", tsx);
  SyntaxHighlighter.registerLanguage("typescript", typescript);
  SyntaxHighlighter.registerLanguage("yaml", yaml);
  languagesRegistered = true;
}

function normalizeLanguage(language: string) {
  const normalized = language.toLowerCase();
  return languageAliases[normalized] ?? normalized;
}

export function SyntaxCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  ensureLanguagesRegistered();
  const normalizedLanguage = normalizeLanguage(language || "text");

  return (
    <SyntaxHighlighter
      language={normalizedLanguage}
      style={oneDark}
      PreTag="div"
      customStyle={{ margin: 0, padding: "0.75rem", background: "transparent" }}
      codeTagProps={{ style: { background: "transparent" } }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
