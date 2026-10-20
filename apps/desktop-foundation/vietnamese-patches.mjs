// Copyright (c) 2026 AIKING.
// Vietnamese (vi-VN) language: the full catalog (overrides/src/locales/vi.json) and the AIKINGBOT interface text
// (overrides/src/aiking/strings.vi.ts) join the upstream i18n. The language chooser, its saved choice (omb-language) and
// the system-language default are upstream behavior and need nothing else.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const VIETNAMESE_PATCHED_FILES = ["src/locales/index.ts", "src/lib/i18n.test.ts", "src/pair/PairPage.tsx", "src/main.tsx"];

export function patchVietnamese(source) {
  const edit = (path, ...pairs) => {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (!text.includes(before) || text.split(before).length !== 2) throw new Error(`Vietnamese patch anchor changed or is not unique: ${path}: ${before.slice(0, 80)}`);
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  };
  edit("src/main.tsx",
    ['import { StrictMode } from "react";', 'import { initializeLocale } from "./aiking/initial-locale";\nimport { StrictMode } from "react";'],
    ['settleAdvancedModeDefault();', 'initializeLocale();\nsettleAdvancedModeDefault();']);
  edit("src/locales/index.ts",
    ['import uk from "./uk.json";', 'import uk from "./uk.json";\nimport vi from "./vi.json";'],
    ['  uk,\n};', '  uk,\n  vi,\n  "vi-vn": vi,\n};'],
    ['  { code: "en", label: "English" },\n', '  { code: "en", label: "English" },\n  { code: "vi", label: "Tiếng Việt" },\n']);
  // The picker test lists every language; Vietnamese is the second.
  edit("src/lib/i18n.test.ts",
    ['"en", "de", "es", "fr", "hi", "ja", "pt-BR", "zh", "zh-TW", "uk",', '"en", "vi", "de", "es", "fr", "hi", "ja", "pt-BR", "zh", "zh-TW", "uk",']);
  // The sign-in page is the first thing a Vietnamese person sees: its text reads through the AIKINGBOT pack too.
  edit("src/pair/PairPage.tsx",
    ['import { pairedDestination } from "../lib/phone-pairing";', 'import { pairedDestination } from "../lib/phone-pairing";\nimport { at } from "../aiking/strings";'],
    ['`We emailed an 8-character code to ${email} from AIKINGBOT. The code only proves this address: you see the workspaces and computers this account owns or was invited to. It works once and expires in ten minutes. Check your spam folder if it has not arrived.` : "Enter your email and we will send you a one-time code.";', 'at("pair.introSent", { email }) : at("pair.introEmail");'],
    ['return "To open My Cloud, choose Open My Cloud in the AIKINGBOT app on your computer (Settings → AIKINGBOT Cloud), or Use in your browser on your Plan page. Have a pairing code? Enter it below.";', 'return at("pair.introCloud");'],
    ['return "Enter the pairing code shown on the server. Codes work once and expire after five minutes.";', 'return at("pair.introCode");'],
    ['{cloudHome ? "Opening My Cloud…" : `Connecting to ${environment?.label ?? "this AIKINGBOT"}…`}', '{cloudHome ? at("pair.openingCloud") : at("pair.connectingTo", { label: environment?.label ?? at("pair.thisServer") })}'],
    ['{cloudHome ? "My Cloud" : `${mode === "email" ? "Sign in to" : "Connect to"} ${environment?.label ?? "this AIKINGBOT"}`}', '{cloudHome ? "My Cloud" : at(mode === "email" ? "pair.signInTo" : "pair.connectTo", { label: environment?.label ?? at("pair.thisServer") })}'],
    ['{environment && !cloudHome ? `Version ${environment.version} on ${environment.platform}. ` : ""}', '{environment && !cloudHome ? `${at("pair.version", { version: environment.version, platform: environment.platform })} ` : ""}'],
    ['>This link has expired or was already used. In the AIKINGBOT app on your computer, open Settings → AIKINGBOT Cloud and choose Open My Cloud.</p>', '>{at("pair.cloudExpired")}</p>'],
    ['            This browser is already connected.{" "}\n            <a href="/" className="text-accent underline">\n              Open the app', '            {at("pair.alreadyConnected")}{" "}\n            <a href="/" className="text-accent underline">\n              {at("pair.openApp")}'],
    ['htmlFor="signin-email">\n              Email\n', 'htmlFor="signin-email">\n              {at("pair.email")}\n'],
    ['htmlFor="signin-code">\n                  Code from the email\n', 'htmlFor="signin-code">\n                  {at("pair.codeFromEmail")}\n'],
    ['htmlFor="signin-label">\n                  This device\n', 'htmlFor="signin-label">\n                  {at("pair.thisDevice")}\n'],
    ['{busy ? (sent ? "Signing in…" : "Sending…") : sent ? "Sign in" : "Send code"}', '{busy ? (sent ? at("pair.signingIn") : at("pair.sending")) : sent ? at("pair.signIn") : at("pair.sendCode")}'],
    ['                Send a new code\n', '                {at("pair.sendNewCode")}\n'],
    ['              Advanced: connect with a pairing code\n', '              {at("pair.advanced")}\n'],
    ['htmlFor="pair-code">\n              Pairing code\n', 'htmlFor="pair-code">\n              {at("pair.pairingCode")}\n'],
    ['htmlFor="pair-label">\n              This device\n', 'htmlFor="pair-label">\n              {at("pair.thisDevice")}\n'],
    ['{busy ? "Connecting…" : "Connect"}', '{busy ? at("pair.connecting") : at("pair.connect")}'],
    ['                Sign in with your email instead\n', '                {at("pair.emailInstead")}\n']);
}
