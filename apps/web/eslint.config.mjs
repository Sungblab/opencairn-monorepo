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
            ],
          },
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: { "i18next/no-literal-string": "off" },
  },
  {
    files: ["scripts/**/*.mjs"],
    rules: { "i18next/no-literal-string": "off" },
  },
];
