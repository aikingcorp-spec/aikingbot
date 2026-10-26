import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_GENERIC_ERROR,
  configPatchIsExactlyCredential,
  credentialErrorText,
  credentialResumeErrorText,
  parseCredentialCardContext,
} from "../shared/credential-request.ts";

import {
  CREDENTIAL_REFUSAL_MESSAGES,
  CREDENTIAL_REMOTE_DENIED_MESSAGE,
  CREDENTIAL_REQUEST_TTL_MS,
  CREDENTIAL_TARGETS,
  configPatchTouchesCredential,
  credentialCardAdmission,
  credentialCardExpiresAt,
  credentialConfigPatch,
  credentialRefusalText,
  isCredentialTargetId,
  trustedCredentialCopy,
  type CredentialTargetId,
} from "../shared/credential-request.ts";
import { SecretCardGate, isRelayedRequest, relayedCredentialWriteDenied, relayedPhoneProvideDenied } from "./credential-admission.ts";
import { RELAYED_HEADER } from "./aiking/relay.ts";

const AT = 1_000_000;
const TARGETS = Object.keys(CREDENTIAL_TARGETS) as CredentialTargetId[];

describe("S1 registry, mapping and trusted copy", () => {
  it("keeps exactly the six targets and their storage paths", () => {
    expect(TARGETS.sort()).toEqual(["boxToken", "fishAudioKey", "openaiImageApiKey", "opencodeGoApiKey", "ttsKey", "xaiApiKey"]);
    expect(credentialConfigPatch("xaiApiKey", "v")).toEqual({ xai: { key: "v" } });
    expect(credentialConfigPatch("boxToken", "v")).toEqual({ box: { token: "v" } });
    expect(credentialConfigPatch("opencodeGoApiKey", "v")).toEqual({ opencodeGo: { apiKey: "v" } });
    expect(credentialConfigPatch("ttsKey", "v")).toEqual({ tts: { key: "v" } });
    expect(credentialConfigPatch("fishAudioKey", "v")).toEqual({ tts: { fishKey: "v" } });
    expect(credentialConfigPatch("openaiImageApiKey", "v")).toEqual({ imageGen: { key: "v" } });
  });

  it("denies unknown or forged ids", () => {
    for (const forged of ["composioApiKey", "__proto__", "constructor", "xai.key", "https://evil", ""]) {
      expect(isCredentialTargetId(forged)).toBe(false);
    }
  });

  it("shows only registry text, ignoring stored legacy descriptions that carried a reason", () => {
    for (const id of TARGETS) {
      const copy = trustedCredentialCopy(id);
      expect(copy.label).toBe(CREDENTIAL_TARGETS[id].label);
      expect(copy.description).toBe(CREDENTIAL_TARGETS[id].description);
      expect(copy.placeholder).toBe(CREDENTIAL_TARGETS[id].placeholder);
      expect(copy.helpUrl).toBe(CREDENTIAL_TARGETS[id].helpUrl);
      expect(copy.description).not.toMatch(/ignore previous|http|read it back/i);
    }
  });
});

describe("S2 card expiry with an injected clock", () => {
  const card = { expiresAt: AT + CREDENTIAL_REQUEST_TTL_MS };

  it("uses a ten minute constant", () => {
    expect(CREDENTIAL_REQUEST_TTL_MS).toBe(600_000);
  });

  it("admits at TTL-1 and refuses at TTL and TTL+1", () => {
    expect(credentialCardAdmission(card, AT, AT + CREDENTIAL_REQUEST_TTL_MS - 1)).toEqual({ ok: true });
    expect(credentialCardAdmission(card, AT, AT + CREDENTIAL_REQUEST_TTL_MS)).toEqual({ ok: false, reason: "expired" });
    expect(credentialCardAdmission(card, AT, AT + CREDENTIAL_REQUEST_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
  });

  it("ages a legacy card without expiresAt from its message time", () => {
    expect(credentialCardExpiresAt({}, AT)).toBe(AT + CREDENTIAL_REQUEST_TTL_MS);
    expect(credentialCardAdmission({}, AT, AT + CREDENTIAL_REQUEST_TTL_MS - 1)).toEqual({ ok: true });
    expect(credentialCardAdmission({}, AT, AT + CREDENTIAL_REQUEST_TTL_MS)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a card with neither expiry nor message time", () => {
    expect(credentialCardAdmission({}, undefined, AT)).toEqual({ ok: false, reason: "expired" });
    expect(credentialCardAdmission({ expiresAt: "9999999999999" }, undefined, AT)).toEqual({ ok: false, reason: "expired" });
  });

  it("does not extend on reload: the same card gives the same answer at the same time", () => {
    const first = credentialCardAdmission(card, AT, AT + 5);
    const reloaded = credentialCardAdmission({ ...card }, AT + 9_999_999, AT + 5);
    expect(reloaded).toEqual(first);
  });

  it("refuses settled, superseded, dismissed and stopped cards before expiry", () => {
    expect(credentialCardAdmission({ ...card, provided: true }, AT, AT)).toEqual({ ok: false, reason: "provided" });
    expect(credentialCardAdmission({ ...card, dismissed: true }, AT, AT)).toEqual({ ok: false, reason: "dismissed" });
    expect(credentialCardAdmission({ ...card, superseded: true }, AT, AT)).toEqual({ ok: false, reason: "superseded" });
    expect(credentialCardAdmission({ ...card, stopped: true }, AT, AT)).toEqual({ ok: false, reason: "stopped" });
    expect(credentialCardAdmission(undefined, AT, AT)).toEqual({ ok: false, reason: "missing" });
  });
});

describe("S5 in-memory claim gate", () => {
  const mk = () => { let n = 0; return new SecretCardGate(() => `c${++n}`); };
  const must = (r: ReturnType<SecretCardGate["claim"]>) => { if (!r.ok) throw new Error("claim"); return r.claimId; };

  it("allows one writer per card and blocks the second submit", () => {
    const gate = mk();
    expect(gate.claim("card", "t1", "owner")).toEqual({ ok: true, claimId: "c1" });
    expect(gate.claim("card", "t1", "owner")).toEqual({ ok: false, state: "writing" });
    expect(gate.claim("other", "t2", "owner")).toEqual({ ok: true, claimId: "c2" });
  });

  it("F2: one writer per target across cards; another card releasing or committing does not free a held target", () => {
    const gate = mk();
    const a = must(gate.claim("A", "img", "owner"));
    expect(gate.claim("B", "img", "owner")).toEqual({ ok: false, state: "target" });
    // A different card, a wrong claim, or the wrong holder cannot free A target.
    expect(gate.release("B", a)).toBe(false);
    expect(gate.release("A", "wrong")).toBe(false);
    expect(gate.claim("B", "img", "owner")).toEqual({ ok: false, state: "target" });
    expect(gate.release("A", a)).toBe(true);
    expect(gate.claim("B", "img", "owner")).toEqual({ ok: true, claimId: "c2" });
    // Phone and desktop share the same reservation.
    expect(gate.claim("C", "img", "phone:d1")).toEqual({ ok: false, state: "target" });
  });

  it("F1: only the write path with the matching card, claim, target and principal commits", () => {
    const gate = mk();
    const a = must(gate.claim("A", "img", "owner"));
    expect(gate.committed("A", a)).toBe(false);
    expect(gate.beginWrite("A", "wrong", "img", "owner")).toBe(false);
    expect(gate.beginWrite("A", a, "xai", "owner")).toBe(false);
    expect(gate.beginWrite("A", a, "img", "session:x")).toBe(false);
    expect(gate.beginWrite("B", a, "img", "owner")).toBe(false);
    expect(gate.beginWrite("A", a, "img", "owner")).toBe(true);
    // A write already running blocks a second one and a release.
    expect(gate.beginWrite("A", a, "img", "owner")).toBe(false);
    expect(gate.release("A", a)).toBe(false);
    expect(gate.committed("A", a)).toBe(false);
    expect(gate.endWrite("A", a, true)).toBe(true);
    expect(gate.committed("A", a)).toBe(true);
    expect(gate.committed("A", "wrong")).toBe(false);
    // Committed frees the target; the card stays status-only.
    expect(gate.claim("A", "img", "owner")).toEqual({ ok: false, state: "committed" });
    expect(gate.claim("B", "img", "owner")).toEqual({ ok: true, claimId: "c2" });
  });

  it("a failed write keeps the claim for release or retry and never commits", () => {
    const gate = mk();
    const a = must(gate.claim("A", "img", "owner"));
    expect(gate.beginWrite("A", a, "img", "owner")).toBe(true);
    expect(gate.endWrite("A", a, false)).toBe(true);
    expect(gate.committed("A", a)).toBe(false);
    expect(gate.beginWrite("A", a, "img", "owner")).toBe(true);
    expect(gate.endWrite("A", a, false)).toBe(true);
    expect(gate.release("A", a)).toBe(true);
    expect(gate.claim("A", "img", "owner")).toEqual({ ok: true, claimId: "c2" });
  });

  it("makes a retry status-only after commit and lets a failed write be retried", () => {
    const gate = mk();
    const a = must(gate.claim("card", "img", "owner"));
    expect(gate.release("card", "wrong")).toBe(false);
    expect(gate.release("card", a)).toBe(true);
    const b = must(gate.claim("card", "img", "owner"));
    expect(gate.commit("card", "wrong")).toBe(false);
    expect(gate.commit("card", b)).toBe(true);
    expect(gate.claim("card", "img", "owner")).toEqual({ ok: false, state: "committed" });
    expect(gate.release("card", b)).toBe(false);
    expect(gate.holds("card", b)).toBe(true);
  });
});

describe("F3 relayed phone provide", () => {
  const relayed = { headers: { [RELAYED_HEADER]: "nonce" } };
  it("denies a relayed request without the secret companion proof, keeps the proven companion and the unmarked path", () => {
    expect(relayedPhoneProvideDenied(relayed, false)).toBe(true);
    expect(relayedPhoneProvideDenied({ headers: { ...relayed.headers, "x-aikingbot-companion": "1", "x-aikingbot-companion-device": "d" } }, false)).toBe(true);
    expect(relayedPhoneProvideDenied(relayed, true)).toBe(false);
    expect(relayedPhoneProvideDenied({ headers: {} }, false)).toBe(false);
  });
});

describe("S4 relay guard", () => {
  const relayed = { headers: { [RELAYED_HEADER]: "nonce" } };
  const direct = { headers: {} };

  it("detects only the connector's marker, not forged owner or device headers", () => {
    expect(isRelayedRequest(relayed)).toBe(true);
    expect(isRelayedRequest({ headers: { "x-aikingbot-companion": "1", "x-aikingbot-companion-device": "d" } })).toBe(false);
    expect(isRelayedRequest(direct)).toBe(false);
  });

  it("denies a relayed write of any of the six paths, empty, mixed or external", () => {
    const bodies = [
      { xai: { key: "k" } }, { box: { token: "k" } }, { opencodeGo: { apiKey: "k" } },
      { tts: { key: "k" } }, { tts: { fishKey: "k" } }, { imageGen: { key: "k" } },
      { xai: { key: "" } },
      { xai: { key: "k" }, signIn: { admins: [] }, language: "vi" },
    ];
    for (const body of bodies) {
      expect(configPatchTouchesCredential(body)).toBe(true);
      expect(relayedCredentialWriteDenied(relayed, body, null)).toBe(true);
      expect(relayedCredentialWriteDenied(direct, body, null)).toBe(false);
    }
    expect(relayedCredentialWriteDenied(relayed, { language: "vi" }, "external")).toBe(true);
  });

  it("keeps valid non-secret settings from a relayed caller", () => {
    for (const body of [{}, { language: "vi" }, { tts: { voiceId: "v" } }, { imageGen: { model: "m" } }, null, "x"]) {
      expect(relayedCredentialWriteDenied(relayed, body, null)).toBe(false);
    }
  });
});

describe("S6 fixed localized refusals", () => {
  it("maps codes and fixed server text to EN/VI and nothing else", () => {
    expect(credentialRefusalText(new Error("Error invoking remote method 'credential:set': Error: credential-refused:expired"), "vi-VN"))
      .toBe(CREDENTIAL_REFUSAL_MESSAGES.expired.vi);
    expect(credentialRefusalText(new Error(CREDENTIAL_REFUSAL_MESSAGES.busy.en), "en")).toBe(CREDENTIAL_REFUSAL_MESSAGES.busy.en);
    expect(credentialRefusalText(new Error(CREDENTIAL_REMOTE_DENIED_MESSAGE.en), "vi")).toBe(CREDENTIAL_REMOTE_DENIED_MESSAGE.vi);
    expect(credentialRefusalText(new Error("ECONNRESET sk-live-123"), "en")).toBeNull();
    expect(credentialRefusalText(new Error("credential-refused:__proto__"), "en")).toBeNull();
  });

  it("never carries secret-shaped text in a fixed message", () => {
    for (const entry of Object.values(CREDENTIAL_REFUSAL_MESSAGES)) {
      for (const text of [entry.en, entry.vi]) expect(text).not.toMatch(/sk-|xai-|token=|https?:/i);
    }
  });
});

describe("F5 fixed errors and F1 card context parsing", () => {
  it("shows a fixed localized text for unknown, stored and thrown errors, never the payload", () => {
    for (const locale of ["en", "vi"] as const) {
      const fixed = CREDENTIAL_GENERIC_ERROR[locale];
      expect(credentialErrorText(new Error("QA_FAKE_SECRET_IN_BACKEND_ERROR sk-test"), locale)).toBe(fixed);
      expect(credentialErrorText("stored sk-test-not-real", locale)).toBe(fixed);
      expect(credentialErrorText(undefined, locale)).toBe(fixed);
      expect(credentialErrorText(new Error("credential-refused:expired"), locale)).toBe(CREDENTIAL_REFUSAL_MESSAGES.expired[locale]);
    }
  });

  it("shows a fixed resume-failure text for a stored card error", () => {
    expect(credentialResumeErrorText(new Error("QA_FAKE_SECRET_IN_BACKEND_ERROR"), "en")).toBe("The bot could not be resumed.");
    expect(credentialResumeErrorText("stored sk-test", "vi")).toBe("Không thể tiếp tục bot.");
  });

  it("accepts a card context only for the registry targets and the exact credential patch", () => {
    const ok = { botId: "b", threadId: "t", messageId: "m", target: "openaiImageApiKey", claimId: "c" };
    expect(parseCredentialCardContext(ok)).toEqual(ok);
    expect(parseCredentialCardContext({ ...ok, target: "__proto__" })).toBeNull();
    expect(parseCredentialCardContext({ ...ok, claimId: 1 })).toBeNull();
    expect(parseCredentialCardContext(null)).toBeNull();
    expect(configPatchIsExactlyCredential({ imageGen: { key: "k" } }, "openaiImageApiKey")).toBe(true);
    expect(configPatchIsExactlyCredential({ tts: { fishKey: "k" } }, "fishAudioKey")).toBe(true);
    expect(configPatchIsExactlyCredential({ tts: { fishKey: "k" } }, "ttsKey")).toBe(false);
    expect(configPatchIsExactlyCredential({ imageGen: { key: "k" }, language: "vi" }, "openaiImageApiKey")).toBe(false);
    expect(configPatchIsExactlyCredential({ imageGen: { key: "k", customApiKey: "z" } }, "openaiImageApiKey")).toBe(false);
    expect(configPatchIsExactlyCredential({ imageGen: { key: "" } }, "openaiImageApiKey")).toBe(false);
  });
});

describe("V3 terminal holder reclaim", () => {
  const mk = () => { let n = 0; return new SecretCardGate(() => `c${++n}`); };
  const must = (r: ReturnType<SecretCardGate["claim"]>) => { if (!r.ok) throw new Error(r.state); return r.claimId; };

  it("a pending holder whose own card became terminal is reclaimed by another card; late write under the old claim is refused", () => {
    const gate = mk(); let aUsable = true;
    const a = must(gate.claim("A", "img", "owner", () => aUsable));
    expect(gate.claim("B", "img", "owner")).toEqual({ ok: false, state: "target" });
    aUsable = false;
    const b = must(gate.claim("B", "img", "owner"));
    expect(gate.beginWrite("A", a, "img", "owner")).toBe(false);
    expect(gate.endWrite("A", a, true)).toBe(false);
    expect(gate.committed("A", a)).toBe(false);
    expect(gate.holds("B", b)).toBe(true);
  });

  it("another card going terminal or releasing never frees a live holder", () => {
    const gate = mk();
    const a = must(gate.claim("A", "img", "owner", () => true));
    expect(gate.claim("B", "img", "owner", () => false)).toEqual({ ok: false, state: "target" });
    expect(gate.release("B", a)).toBe(false);
    expect(gate.claim("C", "img", "owner")).toEqual({ ok: false, state: "target" });
    expect(gate.holds("A", a)).toBe(true);
  });

  it("a writer that is applying is not reclaimed; success commits and frees, failure leaves it reclaimable", () => {
    const gate = mk(); let usable = true;
    const a = must(gate.claim("A", "img", "owner", () => usable));
    expect(gate.beginWrite("A", a, "img", "owner")).toBe(true);
    usable = false; // dismissed or superseded while the write runs
    expect(gate.claim("B", "img", "owner")).toEqual({ ok: false, state: "target" });
    expect(gate.release("A", a)).toBe(false);
    expect(gate.endWrite("A", a, true)).toBe(true);
    expect(gate.committed("A", a)).toBe(true);
    expect(gate.claim("B", "img", "owner")).toEqual({ ok: true, claimId: "c2" });

    const g2 = mk(); let u2 = true;
    const x = must(g2.claim("X", "img", "owner", () => u2));
    expect(g2.beginWrite("X", x, "img", "owner")).toBe(true);
    u2 = false;
    expect(g2.claim("Y", "img", "owner")).toEqual({ ok: false, state: "target" });
    expect(g2.endWrite("X", x, false)).toBe(true); // failed: not committed
    expect(g2.committed("X", x)).toBe(false);
    expect(g2.beginWrite("X", x, "img", "owner")).toBe(true); // same live-claim retry still possible at gate level
    expect(g2.endWrite("X", x, false)).toBe(true);
    expect(g2.claim("Y", "img", "owner")).toEqual({ ok: true, claimId: "c2" });
  });

  it("failed write on a live card keeps the claim for retry or release", () => {
    const gate = mk();
    const a = must(gate.claim("A", "img", "owner", () => true));
    expect(gate.beginWrite("A", a, "img", "owner")).toBe(true);
    expect(gate.endWrite("A", a, false)).toBe(true);
    expect(gate.claim("B", "img", "owner")).toEqual({ ok: false, state: "target" });
    expect(gate.release("A", a)).toBe(true);
    expect(gate.claim("B", "img", "owner")).toEqual({ ok: true, claimId: "c2" });
  });
});
