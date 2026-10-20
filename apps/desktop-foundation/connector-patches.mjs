// Copyright (c) 2026 AIKING.
// Official app connectors sign in on the workspace's own https address. Upstream sends a pre-registered sign-in app
// back to a loopback port with paste-back, which an app registered for a web workspace (GitHub, Slack, HubSpot,
// Discord, Google web clients) cannot accept; and Google issues a refresh token only when asked for offline access.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONNECTOR_PATCHED_FILES = ["server/mcp-oauth.ts", "server/mcp-oauth.test.ts"];

export function patchConnectors(source) {
  const edit = (path, ...pairs) => {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (text.split(before).length !== 2) throw new Error(`Connector patch anchor changed or is not unique: ${path}: ${before.slice(0, 80)}`);
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  };
  edit("server/mcp-oauth.ts",
    [`    const registered = this.clients(name, url);

    if (!registered && starting.browser.remote && starting.browser.origin) {`,
    `    const registered = this.clients(name, url);

    // A sign-in app registered for this workspace's web address returns there, like a self-registered one.
    if (registered && starting.browser.remote && starting.browser.origin) {
      const redirectUri = \`\${starting.browser.origin}\${CALLBACK_PATH}\`;
      const client: ClientAuth = { id: registered.clientId, ...(registered.clientSecret ? { secret: registered.clientSecret } : {}), method: tokenAuthMethod(meta, registered.clientSecret) };
      return { ...this.open(name, url, starting, meta, redirectUri, client, null, registered.scopes?.length ? registered.scopes : meta.scopes).status };
    }

    if (!registered && starting.browser.remote && starting.browser.origin) {`],
    [`    if (scopes?.length) authorize.searchParams.set("scope", scopes.join(" "));\n`,
    `    if (scopes?.length) authorize.searchParams.set("scope", scopes.join(" "));
    // Google returns a refresh token only for offline access, and again only with renewed consent.
    if (authorize.hostname === "accounts.google.com") {
      authorize.searchParams.set("access_type", "offline");
      authorize.searchParams.set("prompt", "consent");
    }
`]);
  edit("server/mcp-oauth.test.ts",
    [`  it("keeps an app registered in advance on its loopback redirect, pasted", async () => {
    await setup({ noRegistration: true, preRegistered: { corp: null } });
    registered = { clientId: "corp" };
    const started = await manager.start("docs", mcp.url, undefined, "alice", elsewhere);
    expect(new URL(started.authorizationUrl!).searchParams.get("redirect_uri")).toBe(mcpOAuthRedirectUri(mcp.url));
    expect(started.pasteBack).toBe(true);`,
    `  it("returns an app registered in advance to this server's https address, with nothing to paste", async () => {
    await setup({ noRegistration: true, preRegistered: { corp: null } });
    registered = { clientId: "corp" };
    const started = await manager.start("docs", mcp.url, undefined, "alice", elsewhere);
    expect(new URL(started.authorizationUrl!).searchParams.get("redirect_uri")).toBe(\`\${elsewhere.origin}/mcp-oauth/callback\`);
    expect(started.pasteBack).toBeUndefined();`]);
}
