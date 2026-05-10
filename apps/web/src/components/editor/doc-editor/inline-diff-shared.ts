export const TRANSLATE_LANGUAGES = ["ko", "en", "ja", "zh"] as const;
export type TranslateLanguage = (typeof TRANSLATE_LANGUAGES)[number];
