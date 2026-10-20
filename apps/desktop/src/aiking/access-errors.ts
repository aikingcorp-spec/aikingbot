// Copyright (c) 2026 AIKING.
// The server's access refusals name the security rule; people need to know which sign-in or role fixes it.
// The rule text stays on the ApiError body, so support logs keep the exact cause.
const RULES: Array<[RegExp, string]> = [
  [/^forbidden: this change must come from the desktop app or a paired device/,
    "This change needs the AIKINGBOT app on this computer or a signed-in device. Quit and reopen AIKINGBOT; in a web browser, sign in to this workspace with your email first."],
  [/^forbidden: this session lacks the admin scope/,
    "Your role in this workspace cannot change this. Ask a workspace owner or admin to do it, or to make you an admin in Settings → People."],
  [/^unauthorized: this session has expired or was revoked/,
    "You were signed out of this workspace. Reload the page and sign in again with your email."],
  [/^forbidden: (?:this request came through a proxy|loopback host required)/,
    "Sign in to this workspace to use it from this device."],
  [/^forbidden: on this shared server a local request without a session/,
    "Sign in to this workspace to change its settings, people or access."],
  [/^forbidden: this browser's session makes changes only from its own page/,
    "Open this workspace in its own tab and try again."],
  [/^forbidden: cross-origin request/,
    "This page is not allowed to change the workspace. Open the workspace address directly and try again."],
];

export function friendlyAccessError(status: number, message: string): string {
  if (status !== 401 && status !== 403) return message;
  return RULES.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}
