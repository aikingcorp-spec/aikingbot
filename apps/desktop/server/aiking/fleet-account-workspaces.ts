// Map a fleet registry + per-workspace sign-in lists onto the account workspace picker.
// The host with the fleet agent is the only place that can see every server; each target
// still re-checks its own allow-list on enter/sign-in.
import { allowedScopes, type SignInAllowList } from "../account-signin.ts";
import type { AccountWorkspace, WorkspaceRole } from "./account-workspaces.ts";

export interface FleetMembershipWorkspace {
  slug: string;
  host: string;
  name?: string;
  status?: string;
  signIn: SignInAllowList;
}

export function roleFromSignIn(email: string, list: SignInAllowList): WorkspaceRole | null {
  const scopes = allowedScopes(email, list);
  if (!scopes) return null;
  return scopes.includes("admin") ? "owner" : "member";
}

/** Workspaces on this VPS fleet the address may open. `currentId` marks the process serving the request. */
export function fleetAccountWorkspaces(
  email: string,
  fleet: FleetMembershipWorkspace[],
  options: { currentId: string; currentName?: string } ,
): AccountWorkspace[] {
  const out: AccountWorkspace[] = [];
  for (const workspace of fleet) {
    if (workspace.status === "retained" || workspace.status === "error") continue;
    const role = roleFromSignIn(email, workspace.signIn);
    if (!role) continue;
    const current = workspace.slug === options.currentId || workspace.host === options.currentId;
    const name = workspace.name?.trim() || workspace.slug;
    out.push({
      id: workspace.slug,
      name: current && options.currentName ? options.currentName : name,
      role,
      current,
      ...(current ? {} : { url: `https://${workspace.host}` }),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Read admins/members from a workspace config.json body. Missing or malformed → empty lists. */
export function signInFromConfigText(text: string): SignInAllowList {
  try {
    const parsed: unknown = JSON.parse(text || "{}");
    const raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    const signIn = raw.signIn && typeof raw.signIn === "object" ? (raw.signIn as { admins?: unknown; members?: unknown }) : {};
    const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => String(item).trim().toLowerCase()).filter(Boolean) : []);
    return { admins: list(signIn.admins), members: list(signIn.members) };
  } catch {
    return { admins: [], members: [] };
  }
}
