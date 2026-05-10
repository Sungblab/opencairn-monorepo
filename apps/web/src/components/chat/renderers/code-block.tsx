"use client";
import { useEffect, useState, type ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Copy, Check } from "lucide-react";
import { proseClasses } from "@/lib/markdown/shared-prose";
import { MermaidChat } from "./mermaid-chat";

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  node?: unknown;
}

type SyntaxCodeBlockProps = {
  code: string;
  language: string;
};

type SyntaxCodeBlockComponent = ComponentType<SyntaxCodeBlockProps>;

let syntaxCodeBlockPromise: Promise<SyntaxCodeBlockComponent> | null = null;

function loadSyntaxCodeBlock(): Promise<SyntaxCodeBlockComponent> {
  if (!syntaxCodeBlockPromise) {
    syntaxCodeBlockPromise = import("./syntax-code-block").then(
      (mod) => mod.SyntaxCodeBlock,
    );
  }
  return syntaxCodeBlockPromise;
}

export function CodeBlock({ inline, className, children }: CodeBlockProps) {
  const t = useTranslations("chat.renderer");
  const [copied, setCopied] = useState(false);
  const [SyntaxCodeBlock, setSyntaxCodeBlock] =
    useState<SyntaxCodeBlockComponent | null>(null);

  // react-markdown v9: detect block code by presence of language-XXX className.
  // The `inline` prop was removed in v8+; we replicate the check from the
  // official readme: if className matches /language-(\w+)/, it is block code.
  const match = /language-(\S+)/.exec(className ?? "");
  const isBlock = Boolean(match);
  const lang = match?.[1].toLowerCase() ?? "";
  const code = String(children ?? "").replace(/\n$/, "");

  useEffect(() => {
    if (!isBlock || lang === "mermaid") return;
    let cancelled = false;
    loadSyntaxCodeBlock().then((component) => {
      if (!cancelled) setSyntaxCodeBlock(() => component);
    });
    return () => {
      cancelled = true;
    };
  }, [isBlock, lang]);

  if (!isBlock) {
    // Inline code — no language class means inside a paragraph
    return <code className={proseClasses.codeInline}>{children}</code>;
  }

  if (lang === "mermaid") {
    return <MermaidChat code={code} />;
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be denied — fail silently */
    }
  };

  return (
    <div className={`relative my-2 ${proseClasses.codeBlock}`}>
      <div className="flex items-center justify-between border-b border-[color:var(--border)] px-2 py-1 text-[0.7rem] text-[color:var(--fg-muted)]">
        <span data-testid="code-block-lang">{lang || "text"}</span>
        <button
          type="button"
          onClick={onCopy}
          aria-label={t("copy")}
          className="inline-flex items-center gap-1 hover:text-[color:var(--fg-base)]"
          data-testid="code-block-copy"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              {t("copied")}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              {t("copy")}
            </>
          )}
        </button>
      </div>
      {SyntaxCodeBlock ? (
        <SyntaxCodeBlock code={code} language={lang || "text"} />
      ) : (
        <pre className="m-0 overflow-x-auto p-3 text-xs">
          <code className="bg-transparent">{code}</code>
        </pre>
      )}
    </div>
  );
}
