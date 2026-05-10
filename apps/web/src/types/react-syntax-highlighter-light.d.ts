type SyntaxHighlighterProps = {
  children?: import("react").ReactNode;
  codeTagProps?: { style?: import("react").CSSProperties };
  customStyle?: import("react").CSSProperties;
  language?: string;
  PreTag?: string;
  style?: Record<string, import("react").CSSProperties>;
};

type SyntaxHighlighterComponent =
  import("react").ComponentType<SyntaxHighlighterProps> & {
    registerLanguage: (name: string, language: unknown) => void;
  };

declare module "react-syntax-highlighter/dist/esm/prism-light" {
  const SyntaxHighlighter: SyntaxHighlighterComponent;
  export default SyntaxHighlighter;
}

declare module "react-syntax-highlighter/dist/esm/languages/prism/*" {
  const language: unknown;
  export default language;
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  export const oneDark: Record<string, import("react").CSSProperties>;
}
