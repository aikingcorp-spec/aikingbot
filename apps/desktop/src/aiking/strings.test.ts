// Copyright (c) 2026 AIKING.
import { describe, expect, it, vi as mock } from "vitest";
import { localeChoices, locales } from "@/locales";
import en from "@/locales/en.json";
import vi from "@/locales/vi.json";
import { resolveLocale, setLocale, t } from "@/lib/i18n";
import { aikingEnglish, at, type AikingKey } from "./strings";
import { vi as aikingVi } from "./strings.vi";
import { initializeLocale } from "./initial-locale";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("Vietnamese language (vi-VN)", () => {
  it("the catalog covers every English key with the same placeholders and no empty text", () => {
    expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(vi[key].trim(), key).not.toBe("");
      expect(placeholders(vi[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("the AIKINGBOT interface pack covers every key with the same placeholders", () => {
    const keys = Object.keys(aikingEnglish) as AikingKey[];
    expect(keys.length).toBeGreaterThan(200);
    expect(Object.keys(aikingVi).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(aikingVi[key]!.trim(), key).not.toBe("");
      expect(placeholders(aikingVi[key]!), key).toEqual(placeholders(aikingEnglish[key]));
    }
  });

  it("is offered in the language chooser and chosen for Vietnamese system languages", () => {
    expect(localeChoices.find((choice) => choice.code === "vi")?.label).toBe("Tiếng Việt");
    expect(locales.vi).toBe(vi);
    for (const tag of ["vi", "vi-VN", "vi-vn"]) expect(resolveLocale(tag, new Set(Object.keys(locales)))).toBe(tag.toLowerCase().startsWith("vi-vn") ? "vi-vn" : "vi");
  });

  it("switches between Vietnamese and English at runtime, for the catalog and the AIKINGBOT pack", () => {
    setLocale("vi");
    expect(t("chat.tasks.title")).toBe("Tác vụ");
    expect(t("settings.title")).toBe("Cài đặt");
    expect(at("market.addAgent")).toBe("Thêm agent");
    expect(at("conn.server", { count: 2 })).toBe("2 máy chủ");
    setLocale("en");
    expect(t("chat.tasks.title")).toBe("Tasks");
    expect(at("market.addAgent")).toBe("Add agent");
    setLocale("vi-VN");
    expect(t("settings.title")).toBe("Cài đặt");
    setLocale("en");
  });
});

it("restores the saved language before sign-in, and falls back to the browser when storage is blocked", () => {
  try {
    mock.stubGlobal("localStorage", { getItem: () => "vi-VN" });
    expect(initializeLocale()).toBe("vi-vn");
    expect(at("pair.sendCode")).toBe("Gửi mã");
    mock.stubGlobal("localStorage", { getItem: () => "en" });
    expect(initializeLocale()).toBe("en");
    expect(at("pair.sendCode")).toBe("Send code");
    mock.stubGlobal("localStorage", { getItem: () => { throw new Error("storage blocked"); } });
    mock.stubGlobal("navigator", { language: "vi-VN" });
    expect(initializeLocale()).toBe("vi-vn");
    mock.stubGlobal("localStorage", { getItem: () => "" });
    expect(initializeLocale()).toBe("vi-vn");
  } finally {
    mock.unstubAllGlobals();
    setLocale("en");
  }
});
