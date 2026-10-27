import type { IncomingMessage } from "node:http";
import { configPatchTouchesCredential } from "../shared/credential-request.ts";
import { RELAYED_HEADER } from "./aiking/relay.ts";

/**
 * In-memory claim for one credential card. `writing` blocks a concurrent
 * submit or retry and holds the target; `committed` is set only by the write
 * path after the credential was saved, and is what a later `provided` needs.
 * It is not durable: a restart forgets it, so this is never an exactly-once guarantee.
 */
export type SecretClaimState = "writing" | "committed";
export type SecretClaimRefusal = SecretClaimState | "target";

interface SecretClaimRecord {
  state: SecretClaimState;
  claimId: string;
  target: string;
  principal: string;
  /** A write under this claim is running; a second one must wait. */
  applying: boolean;
  /** False once the card is gone or terminal (dismissed, superseded, stopped, provided): its claim may be reclaimed unless a write is applying. */
  alive: () => boolean;
}

export class SecretCardGate {
  private readonly claims = new Map<string, SecretClaimRecord>();

  /** One writer per target across every card, thread and path (desktop, fallback, phone). */
  private readonly targetHolders = new Map<string, string>();

  private readonly newId: () => string;

  constructor(newId: () => string) {
    this.newId = newId;
  }

  /** Take the card and its target for one write. Returns the claim id, or what blocks it. */
  claim(
    cardKey: string,
    target: string,
    principal: string,
    alive: () => boolean = () => true,
  ): { ok: true; claimId: string } | { ok: false; state: SecretClaimRefusal } {
    const held = this.claims.get(cardKey);
    if (held) return { ok: false, state: held.state };
    const holderKey = this.targetHolders.get(target);
    if (holderKey !== undefined) {
      const holder = this.claims.get(holderKey);
      // Only the holder's own card gone or terminal (deleted, dismissed, superseded, stopped) lets a pending, not-applying claim be reclaimed.
      // Another card's dismiss/release never frees it, and a running write is never interrupted: it ends in commit (frees) or failure (reclaimable next time).
      if (holder && !holder.applying && !holder.alive()) {
        this.claims.delete(holderKey);
        this.targetHolders.delete(target);
      } else return { ok: false, state: "target" };
    }
    const claimId = this.newId();
    this.claims.set(cardKey, { state: "writing", claimId, target, principal, applying: false, alive });
    this.targetHolders.set(target, cardKey);
    return { ok: true, claimId };
  }

  state(cardKey: string): SecretClaimState | null {
    return this.claims.get(cardKey)?.state ?? null;
  }

  holds(cardKey: string, claimId: string): boolean {
    return this.claims.get(cardKey)?.claimId === claimId;
  }

  /** The write path asks before touching the store: same card, claim, target and principal, and no write already running. */
  beginWrite(cardKey: string, claimId: string, target: string, principal: string): boolean {
    const held = this.claims.get(cardKey);
    if (
      !held || held.claimId !== claimId || held.state !== "writing" || held.applying ||
      held.target !== target || held.principal !== principal
    ) return false;
    held.applying = true;
    return true;
  }

  /** The write path finished. Success commits (and frees the target); failure keeps the claim for a release or retry. */
  endWrite(cardKey: string, claimId: string, saved: boolean): boolean {
    const held = this.claims.get(cardKey);
    if (!held || held.claimId !== claimId || held.state !== "writing" || !held.applying) return false;
    held.applying = false;
    if (!saved) return true;
    held.state = "committed";
    this.freeTarget(held.target, cardKey);
    return true;
  }

  /** Whether this claim was committed by the write path. */
  committed(cardKey: string, claimId: string): boolean {
    const held = this.claims.get(cardKey);
    return held?.claimId === claimId && held.state === "committed";
  }

  /** The phone path writes through its own bridge: commit after that save. */
  commit(cardKey: string, claimId: string): boolean {
    const held = this.claims.get(cardKey);
    if (!held || held.claimId !== claimId || held.state !== "writing") return false;
    held.state = "committed";
    held.applying = false;
    this.freeTarget(held.target, cardKey);
    return true;
  }

  /** The write failed before it was applied: the card and target can be used again. Only the holder of the claim can release. */
  release(cardKey: string, claimId: string): boolean {
    const held = this.claims.get(cardKey);
    if (!held || held.claimId !== claimId || held.state !== "writing" || held.applying) return false;
    this.claims.delete(cardKey);
    this.freeTarget(held.target, cardKey);
    return true;
  }

  private freeTarget(target: string, cardKey: string): void {
    if (this.targetHolders.get(target) === cardKey) this.targetHolders.delete(target);
  }
}

/** The connector marks every replayed request. Used only to deny, never to authorize. */
export function isRelayedRequest(req: Pick<IncomingMessage, "headers">): boolean {
  return req.headers[RELAYED_HEADER] !== undefined;
}

/**
 * Relayed requests may not write a card credential, even in a mixed patch that
 * also carries valid settings, nor ask for the external-storage tombstone path.
 * Runs before any side effect; non-credential settings are untouched.
 */
export function relayedCredentialWriteDenied(
  req: Pick<IncomingMessage, "headers">,
  body: unknown,
  secretStorage: string | null,
): boolean {
  return isRelayedRequest(req) && (configPatchTouchesCredential(body) || secretStorage === "external");
}

/** A relayed request may reach the phone credential route only with the secret companion proof. */
export function relayedPhoneProvideDenied(req: Pick<IncomingMessage, "headers">, companionProven: boolean): boolean {
  return isRelayedRequest(req) && !companionProven;
}
