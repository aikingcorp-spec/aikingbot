// Copyright (c) 2026 AIKING.
export function workspaceJoinURL(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 2048 || /[\s\\]/.test(text)) return null;
  try {
    const url = new URL(text.includes("://") ? text : "https://" + text);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    if (url.username || url.password || (!local && !url.hostname.includes("."))) return null;
    const managed=/^\/servers\/[a-f0-9-]{36}(?:\/pair)?\/?$/.test(url.pathname);
    if (!managed && !["/", "/pair", "/pair/"].includes(url.pathname)) return null;
    const keys = [...url.searchParams.keys()];
    if (keys.some(key => key !== "email") || keys.length > 1) return null;
    const email = url.searchParams.get("email");
    if (email !== null && (email.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return null;
    if (url.hash && !/^#code=[A-Z0-9-]{12,16}$/i.test(url.hash)) return null;
    if (url.hash && url.pathname === "/") return null;
    const base=managed?url.pathname.replace(/\/pair\/?$|\/$/g,""):"";
    return url.origin + base + "/pair" + url.search + url.hash;
  } catch { return null; }
}
