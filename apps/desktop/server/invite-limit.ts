/** Invite seats on a workspace: admins + members except the owner; each @domain counts as 1. */
export const DEFAULT_INVITE_LIMIT = 5;

/** First admin is the workspace owner and does not count toward the invite limit. */
export function inviteOwner(admins: string[]): string | null {
  const owner = admins.map((entry) => entry.trim().toLowerCase()).find(Boolean);
  return owner ?? null;
}

/** Distinct admins+members except the owner. Each @domain entry counts as 1. */
export function countInvites(admins: string[], members: string[]): number {
  const owner = inviteOwner(admins);
  const unique = new Set(
    [...admins, ...members].map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );
  if (owner) unique.delete(owner);
  return unique.size;
}

export function resolveInviteLimit(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 5000) return value;
  return DEFAULT_INVITE_LIMIT;
}

export function inviteLimitError(limit: number): string {
  return `invite limit reached (${limit}); raise it in People`;
}

/** Refuse only when the patch adds seats past the limit (raising the limit or removing people stays allowed). */
export function assertInviteLimitAllows(
  previous: { admins?: string[]; members?: string[]; inviteLimit?: unknown },
  next: { admins?: string[]; members?: string[]; inviteLimit?: unknown },
): void {
  const limit = resolveInviteLimit(next.inviteLimit ?? previous.inviteLimit);
  const before = countInvites(previous.admins ?? [], previous.members ?? []);
  const after = countInvites(next.admins ?? [], next.members ?? []);
  if (after > limit && after > before) throw new Error(inviteLimitError(limit));
}
