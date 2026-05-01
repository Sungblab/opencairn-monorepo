import nextPlugin from "@next/eslint-plugin-next";
import i18next from "eslint-plugin-i18next";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      i18next,
      "@next/next": nextPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-text-only",
          "jsx-attributes": {
            include: ["alt", "aria-label", "title", "placeholder"],
          },
          callees: { exclude: ["useTranslations", "getTranslations", "console\\.(log|warn|error)"] },
          words: {
            exclude: [
              "^\\s*$",
              "^[0-9]+$",
              "^[!-/:-@\\[-`{-~]+$",
              "^[\\u2000-\\u27BF]+$",
              "^OpenCairn$",
              "^GitHub$",
              // landing-only typographic decorations (not translated content)
              "·",
              "^\\.v0\\.1$",
              "^⌘ K$",
              ":\\s*\\[",
              "\\]",
              // decorative glyphs in icon buttons — spoken label is on aria-label,
              // not the visible character. `×` is U+00D7 (close), `🤖` is U+1F916
              // (AI accent prefix beside a translated label).
              "^×$",
              "🤖",
            ],
          },
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/^(\\/[a-z]{2}\\/(app\\/w\\/|app\\/dashboard|app\\/settings\\/(ai|mcp)|workspace\\/)|\\/workspace\\/)/]",
          message:
            "Use urls.* helper from @/lib/urls instead of hardcoded paths.",
        },
        {
          selector:
            "TemplateElement[value.raw=/\\/app\\/w\\/|\\/app\\/dashboard|\\/app\\/settings\\/(ai|mcp)|\\/workspace\\//]",
          message:
            "Use urls.* helper from @/lib/urls instead of hardcoded paths.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: {
      "i18next/no-literal-string": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: [
      "next.config.ts",
      "src/lib/urls.ts",
      "src/lib/url-parsers.ts",
      "tests/e2e/url-redirects.spec.ts",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    // shadcn/ui primitives — library-style components; literal strings (e.g., screen-reader "Close")
    // are expected defaults. Consumers translate at usage sites.
    files: ["src/components/ui/**/*.{ts,tsx}"],
    rules: { "i18next/no-literal-string": "off" },
  },
  {
    files: ["scripts/**/*.mjs"],
    rules: { "i18next/no-literal-string": "off" },
  },
];
