// Copyright (c) 2026 AIKING.
// Account vs workspace on a hosted AIKINGBOT server. With the AIKINGBOT Auth API configured, any address can prove
// itself with an email code and gets an account session (its own workspace list and linked machines); a workspace
// session is still issued only to members of this server (AIKING_WORKSPACE_OWNERS, People). Without the Auth API the
// upstream behaviour is unchanged: the allow-list refuses strangers before a code is sent.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ACCOUNT_WORKSPACE_PATCHED_FILES = ["server/account-signin.ts", "server/index.ts", "src/main.tsx", "src/pair/PairPage.tsx"];

export function patchAccountWorkspaces(source) {
  const edit = (path, ...pairs) => {
    const file = join(source, path); let text = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    for (const [before, after] of pairs) {
      if (text.split(before).length !== 2) throw new Error(`Account workspace patch anchor changed or is not unique: ${path}: ${before.slice(0, 80)}`);
      text = text.replace(before, after);
    }
    writeFileSync(file, text);
  };

  edit("server/account-signin.ts",
    ["  client?: ControlPlaneClient;\n}): EmailSignIn {", "  client?: ControlPlaneClient;\n  /** Identity for everyone, membership still from the allow-list: a stranger is verified with no scopes. */\n  openIdentity?: boolean;\n}): EmailSignIn {"],
    ["    enabled: () => signInEnabled(allow()),", "    enabled: () => options.openIdentity === true || signInEnabled(allow()),"],
    ["      if (!allowedScopes(email, allow())) return NOT_WELCOME;\n", "      if (!options.openIdentity && !allowedScopes(email, allow())) return NOT_WELCOME;\n"],
    ["      if (!email || !allowedScopes(email, allow())) return NOT_WELCOME;", "      if (!email || (!options.openIdentity && !allowedScopes(email, allow()))) return NOT_WELCOME;"],
    ["      if (!scopes) return NOT_WELCOME;\n      return { ok: true,", "      if (!scopes) return options.openIdentity ? { ok: true, email: verified.user.email, userId: verified.user.id, scopes: [] } : NOT_WELCOME;\n      return { ok: true,"]);

  edit("server/index.ts",
    ['import { createAikingServices } from "./aiking/services.ts";', 'import { createAikingServices } from "./aiking/services.ts";\nimport { AccountDirectory, accountCookieName, createAccountRoutes, type AccountWorkspace } from "./aiking/account-workspaces.ts";\nimport { accountApiOrigin } from "./aiking/account-api.ts";'],
    ["const emailSignIn = createEmailSignIn({\n  allow: signInAllowList,\n});\n", `// The AIKINGBOT Auth API proves any address; this server's membership alone opens its workspace.
const AIKING_OPEN_ACCOUNTS = !DESKTOP_MANAGED && Boolean(accountApiOrigin(process.env.AIKING_ACCOUNT_API_URL)) && process.env.AIKING_ACCOUNT_SHELL !== "off";
const emailSignIn = createEmailSignIn({
  allow: signInAllowList,
  openIdentity: AIKING_OPEN_ACCOUNTS,
});
const accountWorkspaceList = (email: string): AccountWorkspace[] => {
  const scopes = allowedScopes(email, signInAllowList());
  if (!scopes) return [];
  const name = process.env.AIKING_WORKSPACE_NAME?.trim() || environmentDescriptor({ environmentId: ENVIRONMENT_ID, desktopManaged: DESKTOP_MANAGED }).label;
  return [{ id: ENVIRONMENT_ID, name, role: scopes.includes("admin") ? "owner" : "member", current: true }];
};
const accountRoutes = createAccountRoutes({
  directory: new AccountDirectory(join(DATA_DIR, "aiking", "account-directory.json")),
  cookieName: accountCookieName(ENVIRONMENT_ID),
  workspacesFor: accountWorkspaceList,
  enterWorkspace: (identity, label, req) => {
    const scopes = allowedScopes(identity.email, signInAllowList());
    if (!scopes) return null;
    const previous = sessions.authenticate(parseCookies(req.headers.cookie).get(SESSION_COOKIE));
    if (previous) sessions.revoke(previous.id);
    const issued = sessions.issue({ label: label || labelFromUserAgent(req.headers["user-agent"]), scopes, userId: identity.userId, email: identity.email });
    return serializeSessionCookie(SESSION_COOKIE, issued.token, { secure: requestOrigin(req)?.startsWith("https://") === true, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) });
  },
  endWorkspaceSession: (req) => {
    const previous = sessions.authenticate(parseCookies(req.headers.cookie).get(SESSION_COOKIE));
    if (previous) sessions.revoke(previous.id);
    return clearSessionCookie(SESSION_COOKIE);
  },
  attemptAllowed: (source) => sessions.attemptAllowed(source),
  noteFailure: (source) => sessions.noteFailure(source),
  readBody: async (req) => (await readBody(req)) as Record<string, unknown> | null,
  json,
});
`],
    [`      sessions.clearFailures(source);
      const issued = sessions.issue({ label: label.trim() || labelFromUserAgent(req.headers["user-agent"]), scopes: verified.scopes, userId: verified.userId, email: verified.email });
      const environment = environmentDescriptor({ environmentId: ENVIRONMENT_ID, desktopManaged: DESKTOP_MANAGED, emailSignIn: true, sharedComputers: lendingEnabled() });
      const secure = requestOrigin(req)?.startsWith("https://") === true;
      res.setHeader("set-cookie", serializeSessionCookie(SESSION_COOKIE, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) }));
      return json(res, 200, { session: issued.session, environment });`,
    `      sessions.clearFailures(source);
      const signInLabel = label.trim() || labelFromUserAgent(req.headers["user-agent"]);
      const accountCookie = AIKING_OPEN_ACCOUNTS ? accountRoutes.signInCookie({ userId: verified.userId, email: verified.email }, signInLabel, req) : null;
      // A new sign-in replaces whatever workspace session this browser held, so switching accounts never keeps the old one.
      const previousWorkspace = sessions.authenticate(parseCookies(req.headers.cookie).get(SESSION_COOKIE));
      if (previousWorkspace) sessions.revoke(previousWorkspace.id);
      if (!verified.scopes.length) {
        // Identity only: no workspace session exists for this address, so every workspace route stays closed to it.
        res.setHeader("set-cookie", [...(accountCookie ? [accountCookie] : []), clearSessionCookie(SESSION_COOKIE)]);
        return json(res, 200, { account: { email: verified.email }, workspace: false });
      }
      const issued = sessions.issue({ label: signInLabel, scopes: verified.scopes, userId: verified.userId, email: verified.email });
      const environment = environmentDescriptor({ environmentId: ENVIRONMENT_ID, desktopManaged: DESKTOP_MANAGED, emailSignIn: true, sharedComputers: lendingEnabled() });
      const secure = requestOrigin(req)?.startsWith("https://") === true;
      res.setHeader("set-cookie", [serializeSessionCookie(SESSION_COOKIE, issued.token, { secure, maxAgeSeconds: cookieMaxAgeSeconds(issued.session) }), ...(accountCookie ? [accountCookie] : [])]);
      return json(res, 200, { session: issued.session, environment, account: { email: verified.email }, workspace: true });`],
    ["    const gate = resolveRequestAuth(req, {\n", "    // The account layer answers before the workspace gate and never satisfies it.\n    if (AIKING_OPEN_ACCOUNTS && await accountRoutes.handle(req, res, path, method)) return;\n    const gate = resolveRequestAuth(req, {\n"],
    [`      if (auth.kind === "session") sessions.revoke(auth.session.id);
      res.setHeader("set-cookie", clearSessionCookie(SESSION_COOKIE));`,
    `      if (auth.kind === "session") sessions.revoke(auth.session.id);
      res.setHeader("set-cookie", AIKING_OPEN_ACCOUNTS ? [clearSessionCookie(SESSION_COOKIE), accountRoutes.endAccount(req)] : clearSessionCookie(SESSION_COOKIE));`]);

  // Browser: an account without a workspace session opens its account shell instead of the sign-in page.
  edit("src/main.tsx",
    ['import { PairPage } from "./pair/PairPage";', 'import { PairPage } from "./pair/PairPage";\nimport { readAccountState } from "./aiking/account/account-api";'],
    ['  if (session.kind === "unauthenticated") return <PairPage initialCode={null} reason={session.error} />;', `  if (session.kind === "unauthenticated") {
    const account = await readAccountState();
    if (account) {
      const { AccountShell } = await import("./aiking/account/AccountShell");
      return <AccountShell initial={account} />;
    }
    return <PairPage initialCode={null} reason={session.error} />;
  }`]);

  edit("src/pair/PairPage.tsx",
    ["`We emailed an 8-character code to ${email} from AIKINGBOT.", "`We emailed an 8-character code to ${email} from AIKINGBOT. The code only proves this address: you see the workspaces and computers this account owns or was invited to."]);
}
