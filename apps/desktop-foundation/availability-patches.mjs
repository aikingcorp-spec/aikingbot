// Copyright (c) 2026 AIKING.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const AVAILABILITY_PATCHED_FILES = [
  "src/components/SidebarProfileMenu.tsx", "src/components/SidebarPhoneButton.tsx",
  "src/components/PhoneAppDialog.tsx", "src/components/CloudAccountSettings.tsx",
  "src/components/bot-settings/SimpleBotPanel.tsx", "src/lib/onboarding.ts",
];

export function patchAvailability(source) {
  const edit = (path, ...pairs) => {
    const file = join(source, path);
    let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (!text.includes(before)) throw new Error("Availability patch anchor changed: " + path + ": " + before.slice(0, 80));
      text = text.replace(before, after);
    }
    writeFileSync(file, 'import { mobileAppsAvailable } from "@/aiking/product-availability";\n' + text);
  };
  edit("src/components/SidebarProfileMenu.tsx",
    ['  return [\n    ...destinations.map((destination)', '  if (!mobileAppsAvailable()) return [];\n  return [\n    ...destinations.map((destination)']);
  edit("src/components/SidebarPhoneButton.tsx",
    ['  return <SidebarPhoneStatusButton density={density} status={status} onOpen={onOpen} />;', '  if (!mobileAppsAvailable()) return null;\n  return <SidebarPhoneStatusButton density={density} status={status} onOpen={onOpen} />;']);
  edit("src/components/PhoneAppDialog.tsx", ['  if (!open) return null;', '  if (!mobileAppsAvailable() || !open) return null;']);
  edit("src/components/CloudAccountSettings.tsx",
    ['{plan && onConnectPhone && <button', '{mobileAppsAvailable() && plan && onConnectPhone && <button'],
    ['{signed && view.kind === "paid" && cloudPhoneCard(', '{mobileAppsAvailable() && signed && view.kind === "paid" && cloudPhoneCard(']);
  edit("src/components/bot-settings/SimpleBotPanel.tsx",
    ["  const soon = (\n    <span className=\"shrink-0 rounded-full bg-control px-2 py-0.5 text-[10.5px] font-medium text-ink-secondary\">\n      {t(\"botSettings.simple.soon\")}\n    </span>\n  );\n", ""],
    ['              <Row data-simple-row="phone" title={t("botSettings.simple.phone")} badge={soon} hint={t("botSettings.simple.phoneHint")} />\n', ''],
    ['              <Row data-simple-row="email" title={t("botSettings.simple.email")} badge={soon} hint={t("botSettings.simple.emailHint")} />\n', ''],
    ['            <section data-simple-where>', '            {(mobileAppsAvailable() || slackUrl) && <section data-simple-where>'],
    ['                {([["ios", "phoneApp.ios"], ["android", "phoneApp.android"]] as const).map', '                {mobileAppsAvailable() && ([["ios", "phoneApp.ios"], ["android", "phoneApp.android"]] as const).map'],
    ['            </section>\n\n            <button\n              type="button"\n              data-simple-all-settings', '            </section>}\n\n            <button\n              type="button"\n              data-simple-all-settings']);
  edit("src/lib/onboarding.ts", ['  beats.push("phone", "bot");', '  if (mobileAppsAvailable()) beats.push("phone");\n  beats.push("bot");']);
}
