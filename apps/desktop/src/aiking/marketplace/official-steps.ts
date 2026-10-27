// Copyright (c) 2026 AIKING.
// Localized official-connect setup steps for signIn:"app" providers (Mai VI verbatim).
import { at, type AikingKey } from "../strings";

const COUNTS: Record<string, number> = {
  github: 3,
  gmail: 4,
  googlecalendar: 4,
  googlesheets: 4,
  googledrive: 4,
  slack: 3,
  discord: 2,
  hubspot: 2,
};

/** Provider setup steps in the active locale; falls back to the English catalog steps. */
export function officialProviderSteps(slug: string, fallback: readonly string[]): string[] {
  const count = COUNTS[slug];
  if (!count) return [...fallback];
  const steps: string[] = [];
  for (let i = 0; i < count; i++) {
    const key = `official.steps.${slug}.${i}` as AikingKey;
    steps.push(at(key));
  }
  return steps;
}

export const OFFICIAL_APP_STEP_SLUGS = Object.keys(COUNTS);
