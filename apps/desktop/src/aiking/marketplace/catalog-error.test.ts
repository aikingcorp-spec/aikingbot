// @vitest-environment happy-dom
// A 503 from the live catalog, end to end through HttpCatalogSource -> useCatalog -> CatalogLoadError.
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { AIKING_CATALOG } from "./aiking-catalog";
import { CatalogLoadError, catalogErrorText } from "./CatalogLoadError";
import { catalogSource, CatalogHttpError, CatalogTimeoutError, classifyCatalogError, HttpCatalogSource, setCatalogSource } from "./sources";
import { useCatalog } from "./use-catalog";

function Harness() {
  const { page, error, retrying, retry } = useCatalog("app", "", null);
  if (error) return createElement(CatalogLoadError, { error, retrying, onRetry: retry, onClose: () => {} });
  return createElement("p", { "data-testid": "loaded" }, page ? `${page.items.length}` : "loading");
}

const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); }); };

describe("classifyCatalogError", () => {
  it("maps status and error kind", () => {
    expect(classifyCatalogError(new CatalogHttpError("x", 503), true)).toEqual({ kind: "unavailable", status: 503 });
    expect(classifyCatalogError(new CatalogHttpError("x", 502), true)).toEqual({ kind: "unavailable", status: 502 });
    expect(classifyCatalogError(new CatalogHttpError("x", 429), true)).toEqual({ kind: "unavailable", status: 429 });
    expect(classifyCatalogError(new CatalogHttpError("x", 403), true)).toEqual({ kind: "failed", status: 403 });
    expect(classifyCatalogError(new CatalogTimeoutError("t"), true).kind).toBe("timeout");
    expect(classifyCatalogError(new TypeError("Failed to fetch"), true).kind).toBe("network");
    expect(classifyCatalogError(new Error("?"), false).kind).toBe("network");
    expect(classifyCatalogError(new SyntaxError("bad json"), true).kind).toBe("invalid");
    expect(classifyCatalogError(new Error("?"), true).kind).toBe("failed");
  });

  it("says the reason in Vietnamese and English, with the code", () => {
    setLocale("vi");
    expect(catalogErrorText({ kind: "unavailable", status: 503 })).toMatch(/Mã lỗi 503\./);
    expect(catalogErrorText({ kind: "unavailable", status: 503 })).not.toMatch(/Service|Unavailable/);
    for (const kind of ["timeout", "network", "invalid", "failed"] as const) expect(catalogErrorText({ kind })).not.toBe(`market.loadFailed.${kind}`);
    setLocale("en");
    expect(catalogErrorText({ kind: "unavailable", status: 503 })).toMatch(/Error code 503\./);
  });
});

describe("catalog 503 in the marketplace", () => {
  let host: HTMLDivElement; let root: Root; let previous: ReturnType<typeof catalogSource>;
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    previous = catalogSource();
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    setLocale("vi");
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); setCatalogSource(previous); setLocale("en"); vi.unstubAllGlobals(); });

  it("shows the Vietnamese reason, focuses Retry, keeps focus after a failed retry, then recovers", async () => {
    const answers = [503, 503, 200];
    const fetcher = vi.fn(async () => {
      const status = answers.shift()!;
      return status === 200 ? new Response(JSON.stringify(AIKING_CATALOG)) : new Response("busy", { status });
    });
    setCatalogSource(new HttpCatalogSource("https://catalog.test/api/aiking/", fetcher as unknown as typeof fetch));
    act(() => root.render(createElement(Harness)));
    await flush();

    const alert = host.querySelector('[role="alert"]')!;
    expect(alert.getAttribute("data-error-kind")).toBe("unavailable");
    expect(alert.textContent).toContain("Mã lỗi 503.");
    expect(alert.textContent).toContain("kiểm tra kết nối mạng");
    const retry = [...alert.querySelectorAll("button")].find((b) => b.textContent === "Thử lại")!;
    expect(retry).toBeTruthy();
    expect(document.activeElement).toBe(retry);

    act(() => retry.click());
    expect(retry.isConnected).toBe(true);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    act(() => retry.click()); // ignored while busy
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const again = [...host.querySelectorAll('[role="alert"] button')].find((b) => b.textContent === "Thử lại")!;
    expect(again).toBe(retry);
    expect(document.activeElement).toBe(retry);

    act(() => retry.click());
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(Number(host.querySelector('[data-testid="loaded"]')!.textContent)).toBeGreaterThan(0);
  });
});
