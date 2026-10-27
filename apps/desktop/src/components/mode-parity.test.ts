// 1.11 + 7.1–7.3: Simple vs Advanced is a screen boundary, never a capability boundary.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { SECTIONS, SIMPLE_HIDDEN_SECTIONS, SIMPLE_PAGES, sectionMatches, simplePageMatches, simpleSettingsPages } from "./SettingsModal";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));

const serverRoot = join(import.meta.dirname, "../../server");
const sources = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (name === "node_modules") return [];
  return statSync(path).isDirectory() ? sources(path) : /\.(ts|mjs)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
});

describe("Simple and Advanced share every capability (1.11, 7.1, 7.2)", () => {
  it("the server never reads the interface mode, so tools, prompts and engines are the same in both", () => {
    const readers = sources(serverRoot).filter((file) => /aiking-advanced-mode|advancedMode|interface-mode/.test(readFileSync(file, "utf8")));
    expect(readers).toEqual([]);
  });
  it("Advanced = Simple + more: every section Simple shows exists in Advanced, and Simple hides only manual-setup pages", () => {
    const advanced = new Set(SECTIONS.map((entry) => entry.id));
    const simple = simpleSettingsPages(SECTIONS, "general").flatMap((page) => page.sections);
    expect(simple.filter((id) => !advanced.has(id))).toEqual([]);
    const notInSimple = [...advanced].filter((id) => !SIMPLE_PAGES.some((page) => page.sections.includes(id)));
    expect(notInSimple.filter((id) => !SIMPLE_HIDDEN_SECTIONS.includes(id))).toEqual([]);
  });
});

describe("the Local VM in Simple mode (7.3, wave 1: visible and searchable)", () => {
  it("sits on the Computers page", () => {
    const computers = simpleSettingsPages(SECTIONS, "general").find((page) => page.id === "computers");
    expect(computers?.sections).toContain("computer");
    expect(SIMPLE_HIDDEN_SECTIONS).not.toContain("computer");
  });
  it.each(["vm", "máy ảo", "may ao"])("searching %j finds it in both modes", (query) => {
    for (const locale of ["en", "vi"] as const) {
      setLocale(locale);
      const vm = SECTIONS.find((entry) => entry.id === "computer")!;
      expect(sectionMatches(vm, query)).toBe(true);
      expect(simpleSettingsPages(SECTIONS, "general").filter((page) => simplePageMatches(page, query)).map((page) => page.id)).toContain("computers");
    }
    setLocale("en");
  });
});
