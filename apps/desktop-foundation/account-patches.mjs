// Copyright (c) 2026 AIKING.
// More than one ChatGPT account: upstream offers "Add ChatGPT account" only on a ChatGPT-plan engine, so a workspace
// that signed in to Codex the usual way never sees it. Each added account is its own engine with its own sign-in, and
// each agent chooses which one it uses.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ACCOUNT_PATCHED_FILES = ["src/components/EnginesSettings.tsx"];

export function patchAccounts(source) {
  const file = join(source, "src/components/EnginesSettings.tsx");
  const text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  const before = "      {instance.snapshot.chatgptPlan && !instance.snapshot.authenticationUnavailableReason && (";
  if (text.split(before).length !== 2) throw new Error("Account patch anchor changed: src/components/EnginesSettings.tsx");
  writeFileSync(file, text.replace(before, "      {(instance.snapshot.chatgptPlan || instance.driverKind === \"codex\") && !instance.snapshot.authenticationUnavailableReason && ("));
}
