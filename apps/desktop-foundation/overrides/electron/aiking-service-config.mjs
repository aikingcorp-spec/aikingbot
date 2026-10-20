// Copyright (c) 2026 AIKING.
export function serviceOrigin(value) {
  if (!value?.trim()) return "";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.href !== `${url.origin}/`) throw new Error("AIKING_CLOUD_ORIGIN requires an HTTPS origin without credentials or a path.");
  return url.origin;
}
