// Copyright (c) 2026 AIKING.
import { setLocale } from "../lib/i18n";
import { languageChoice } from "../lib/language-preference";

export function initializeLocale(): string {
  return setLocale(languageChoice() || globalThis.navigator?.language);
}
