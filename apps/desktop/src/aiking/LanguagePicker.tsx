// Copyright (c) 2026 AIKING.
// The first screen lets the person pick the app's language: the welcome tour and every screen after it follow the choice.
import { setLanguageChoice, useLanguageChoice } from "@/lib/language-preference";
import { activeLocale, setLocale } from "@/lib/i18n";
import { at } from "./strings";

const CHOICES = [{ code: "vi", label: "Tiếng Việt" }, { code: "en", label: "English" }] as const;

export function LanguagePicker() {
  const chosen = useLanguageChoice();
  const current = (chosen || activeLocale()).toLowerCase().split("-")[0];
  return (
    <div className="mt-5 flex items-center justify-center gap-2 text-[12.5px] text-ink-secondary" data-language-picker>
      <span>{at("language.label")}:</span>
      {CHOICES.map((choice) => (
        <button key={choice.code} type="button" data-language-choice={choice.code} aria-pressed={current === choice.code} onClick={() => { setLocale(choice.code); setLanguageChoice(choice.code); }}
          className={"rounded-lg px-2.5 py-1 " + (current === choice.code ? "bg-raised text-ink" : "hover:bg-raised-hover")}>{choice.label}</button>
      ))}
    </div>
  );
}
