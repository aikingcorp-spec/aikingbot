export const APP_NAME = "AIKINGBOT";
export const APP_REPOSITORY = "https://github.com/aikingcorp-spec/AIKINGX_Bot";
export const UPSTREAM_REPOSITORY = "https://github.com/milind-soni/OpenMausBot";
export const DOCS_URL = `${APP_REPOSITORY}/tree/main/docs`;
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = `${APP_REPOSITORY}/blob/main/docs/approval-levels.md`;
export const FEEDBACK_URL = `${APP_REPOSITORY}/issues`;
export const RELEASES_URL = `${APP_REPOSITORY}/releases`;
export const PRICING_URL = DOCS_URL;
export function withSource(url: string, source: string): string {
  const target = new URL(url);
  target.searchParams.set("src", source);
  return target.href;
}
export const LICENSE_URL = `${UPSTREAM_REPOSITORY}/blob/93b3c24cdade51e362e443d2387a9f37eb7e115c/LICENSE`;
export const IOS_APP_STORE_URL = DOCS_URL;
export const ANDROID_APK_URL = DOCS_URL;

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

export async function openExternalLink(url: string): Promise<void> {
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
