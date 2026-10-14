export interface Brand {
  name: string;
  tagline?: string;
  accent?: string;
  logo?: string;
  favicon?: string;
  supportUrl?: string;
}

export interface BrandStatus {
  brand: Brand;
  source: "default" | "file";
  file: string;
  notice?: string;
}

export const DEFAULT_BRAND: Brand = {
  name: "AIKINGBOT",
  tagline: "Your AI team, in one workspace.",
  logo: "data:image/svg+xml," + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"16\" fill=\"#111318\"/><path d=\"M32 9 52 44H12Z\" fill=\"none\" stroke=\"#6ee7c0\" stroke-width=\"5\" stroke-linejoin=\"round\"/><path d=\"M24 34h16M32 46v8\" stroke=\"#6ee7c0\" stroke-width=\"4\" stroke-linecap=\"round\"/></svg>"),
  favicon: "data:image/svg+xml," + encodeURIComponent("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"16\" fill=\"#111318\"/><path d=\"M32 9 52 44H12Z\" fill=\"none\" stroke=\"#6ee7c0\" stroke-width=\"5\" stroke-linejoin=\"round\"/><path d=\"M24 34h16M32 46v8\" stroke=\"#6ee7c0\" stroke-width=\"4\" stroke-linecap=\"round\"/></svg>"),
  supportUrl: "https://github.com/aikingcorp-spec/AIKINGX_Bot/issues",
};

let current: BrandStatus = { brand: DEFAULT_BRAND, source: "default", file: "" };

export function brand(): Brand {
  return current.brand;
}

export function brandStatus(): BrandStatus {
  return current;
}

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export function luminance(hex: string): number {
  const m = HEX.exec(hex);
  if (!m) return 0;
  const channel = (h: string) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
}

export function accentInk(accent: string): string {
  // contrast vs white = 1.05 / (L + 0.05); vs black = (L + 0.05) / 0.05
  const l = luminance(accent);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#ffffff" : "#111111";
}

export function brandVars(b: Brand): Record<string, string> {
  if (!b.accent || !HEX.test(b.accent)) return {};
  return {
    "--color-accent": b.accent,
    "--color-accent-border": b.accent,
    "--color-focus": b.accent,
    "--color-accent-text": b.accent,
    "--color-accent-ink": accentInk(b.accent),
  };
}

export function iconType(href: string): string {
  const match = /^data:(image\/[a-z0-9.+-]+)/i.exec(href);
  return match ? match[1].toLowerCase() : "";
}

let defaultIcon: { href: string; type: string } | null = null;

function applyIcon(favicon: string | undefined): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  defaultIcon ??= { href: link.getAttribute("href") ?? "", type: link.getAttribute("type") ?? "" };
  const next = favicon ? { href: favicon, type: iconType(favicon) } : defaultIcon;
  link.setAttribute("href", next.href);
  if (next.type) link.setAttribute("type", next.type);
  else link.removeAttribute("type");
  let touch = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"][data-brand]');
  if (favicon) {
    if (!touch) {
      touch = document.createElement("link");
      touch.rel = "apple-touch-icon";
      touch.dataset.brand = "1";
      document.head.appendChild(touch);
    }
    touch.href = favicon;
  } else touch?.remove();
}

export function applyBrand(status: BrandStatus): void {
  current = status;
  if (typeof document === "undefined") return;
  document.title = status.brand.name;
  applyIcon(status.brand.favicon);
  const root = document.documentElement;
  for (const name of ["--color-accent", "--color-accent-border", "--color-focus", "--color-accent-text", "--color-accent-ink"]) {
    root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(brandVars(status.brand))) root.style.setProperty(name, value);
}

function isBrandStatus(value: unknown): value is BrandStatus {
  if (!value || typeof value !== "object") return false;
  const v = Reflect.get(value, "brand");
  return Boolean(v) && typeof v === "object" && typeof Reflect.get(Object(v), "name") === "string";
}

export async function bootstrapBrand(fetchImpl: typeof fetch = fetch, timeoutMs = 1500): Promise<BrandStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("/api/brand", { signal: controller.signal });
    if (!res.ok) return current;
    const body: unknown = await res.json();
    if (isBrandStatus(body)) applyBrand(body);
  } catch {
  } finally {
    clearTimeout(timer);
  }
  return current;
}
