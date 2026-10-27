import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  phoneMenuItems,
  profileInitials,
  profileMenuItems,
  selectPhoneDestination,
  profileLabel,
  updateBusy,
  updateNoteworthy,
  updateLabel,
  updatePhase,
} from "./SidebarProfileMenu";
import { ANDROID_APK_URL, DOCS_URL, FEEDBACK_URL, HELP_CENTER_URL, IOS_APP_STORE_URL, platformLabel } from "@/lib/app-links";
import {
  cloudPhoneDestination,
  connectPhoneEntry,
  phoneDestinations,
  phonePairingSettingsAction,
  type PhonePairingAccess,
  type PhonePairingTarget,
} from "@/lib/phone-pairing";
import type { CloudAccountState } from "../../electron/cloud-account.mjs";
import { PHONE_APPS, PhoneAppDialog, type PhoneAppConnect } from "./PhoneAppDialog";
import type { UpdaterState } from "@/lib/updater";

const state = (patch: Partial<UpdaterState>): UpdaterState => ({ status: "idle", ...patch }) as UpdaterState;

describe("profileInitials", () => {
  it("takes the first letter of the first two words", () => {
    // Single-token product name → first letter only (was a stale "MS" from an old OpenBot brand).
    expect(profileInitials({ name: "AIKING" })).toBe("A");
    expect(profileInitials({ name: "Ada Byron Lovelace" })).toBe("AB");
  });

  it("falls back to the email, then to a placeholder", () => {
    expect(profileInitials({ email: "you@x.dev" })).toBe("Y");
    expect(profileInitials({})).toBe("?");
    expect(profileInitials(undefined)).toBe("?");
  });

  it("ignores whitespace-only names", () => {
    expect(profileInitials({ name: "   ", email: "you@x.dev" })).toBe("Y");
  });
});

describe("profileLabel", () => {
  it("prefers the name, then the email, then You", () => {
    expect(profileLabel({ name: "Omkar", email: "o@x.dev" })).toBe("Omkar");
    expect(profileLabel({ email: "o@x.dev" })).toBe("o@x.dev");
    expect(profileLabel(undefined)).toBe("You");
  });
});

describe("updatePhase", () => {
  it("reports the bridge's own in-flight states", () => {
    expect(updatePhase(state({ status: "checking" }), false)).toBe("checking");
    expect(updatePhase(state({ status: "downloading" }), false)).toBe("downloading");
    expect(updatePhase(state({ status: "preparing" }), false)).toBe("preparing");
    expect(updatePhase(state({ status: "installing" }), false)).toBe("installing");
  });

  it("acknowledges a check that found nothing", () => {
    expect(updatePhase(null, true)).toBe("up-to-date");
    expect(updatePhase(null, false)).toBe("idle");
  });

  it("lets a real status outrank the acknowledgement", () => {
    expect(updatePhase(state({ status: "downloading" }), true)).toBe("downloading");
  });
});

describe("updateLabel", () => {
  it("names the version it is ready to install", () => {
    expect(updateLabel("downloaded", state({ status: "downloaded", version: "0.2.0" }))).toBe(
      "AIKINGBOT 0.2.0 ready — restart",
    );
  });

  it("shows progress only once there is a percentage", () => {
    expect(updateLabel("downloading", state({ status: "downloading" }))).toBe("Starting download…");
    expect(updateLabel("downloading", state({ status: "downloading", percent: 41.6 }))).toBe("Downloading… 42%");
  });

  it("distinguishes native preparation from restart readiness", () => {
    expect(updateLabel("preparing", state({ status: "preparing", percent: 100 }))).toBe("Preparing update…");
    expect(updateLabel("installing", state({ status: "installing", message: "Restart is taking longer than expected." })))
      .toBe("Restart is taking longer than expected.");
    expect(updateLabel("downloaded", state({ status: "downloaded", version: "0.2.0", installMode: "handoff" })))
      .toBe("AIKINGBOT 0.2.0 ready — install");
    expect(updateLabel("installing", state({ status: "installing", installMode: "handoff" })))
      .toBe("Opening a terminal…");
  });

  it("carries the updater's own message when something failed", () => {
    expect(updateLabel("error", state({ status: "error", message: "Network unreachable" }))).toBe(
      "Network unreachable",
    );
    expect(updateLabel("error", state({ status: "error" }))).toBe("Update failed — try again");
  });

  it("points a hand-off at the terminal that finishes it", () => {
    expect(updateLabel("handed-off", state({ status: "handed-off" }))).toBe(
      "Finish the update in your terminal",
    );
  });

  it("defaults to the invitation to check", () => {
    expect(updateLabel("idle", null)).toBe("Check for updates");
    expect(updateLabel("up-to-date", null)).toBe("You're up to date");
  });
});

describe("updateBusy", () => {
  it("blocks clicks while something is in flight", () => {
    expect(updateBusy("checking")).toBe(true);
    expect(updateBusy("downloading")).toBe(true);
    expect(updateBusy("preparing")).toBe(true);
    expect(updateBusy("installing")).toBe(true);
    expect(updateBusy("downloaded")).toBe(false);
    expect(updateBusy("idle")).toBe(false);
  });

  it("blocks the gap between the click and the bridge catching up", () => {
    expect(updateBusy("downloaded", true)).toBe(true);
    expect(updateBusy("error", true)).toBe(true);
  });
});

describe("platformLabel", () => {
  it("names the platforms we ship, and stays quiet otherwise", () => {
    expect(platformLabel("darwin")).toBe("macOS");
    expect(platformLabel("win32")).toBe("Windows");
    expect(platformLabel("linux")).toBe("Linux");
    expect(platformLabel("freebsd")).toBeNull();
    expect(platformLabel(undefined)).toBeNull();
  });
});

describe("updateNoteworthy", () => {
  it("puts a real update on the profile row", () => {
    expect(updateNoteworthy("downloading")).toBe(true);
    expect(updateNoteworthy("preparing")).toBe(true);
    expect(updateNoteworthy("downloaded")).toBe(true);
    expect(updateNoteworthy("installing")).toBe(true);
    expect(updateNoteworthy("error")).toBe(true);
    expect(updateNoteworthy("handed-off")).toBe(true);
  });

  it("leaves a quiet updater quiet", () => {
    expect(updateNoteworthy("idle")).toBe(false);
    expect(updateNoteworthy("checking")).toBe(false);
    expect(updateNoteworthy("up-to-date")).toBe(false);
  });

  it("shows the click that has not landed yet", () => {
    expect(updateNoteworthy("idle", true)).toBe(true);
  });
});

describe("outward links", () => {
  it("sends Help Center to the docs the website also links to", () => {
    expect(HELP_CENTER_URL).toBe(DOCS_URL);
    expect(DOCS_URL).toBe("https://aikingxbot.com/docs/");
  });

  it("sends Send Feedback to the AIKING site", () => {
    expect(FEEDBACK_URL).toBe("https://aikingx.com");
  });
});

describe("the phone entries", () => {
  const admin: PhonePairingAccess = { session: { kind: "session", id: "s", label: "Mac", scopes: ["admin", "client"], expiresAt: 1 }, pairingCodes: true };
  const items = (target: PhonePairingTarget, access: PhonePairingAccess | null, account: CloudAccountState | null = null, connected = false) => {
    const onConnect = vi.fn(), onGetApp = vi.fn(), onUnsupported = vi.fn();
    const destinations = phoneDestinations(connectPhoneEntry(target, access), cloudPhoneDestination(account));
    return { list: phoneMenuItems({ destinations, connected, onConnect, onGetApp, onUnsupported }), onConnect, onGetApp, onUnsupported };
  };

  it("stays visible as Sắp có / Coming soon while phone pairing is unsupported", () => {
    const { list, onConnect, onUnsupported } = items("computer", null);
    expect(list).toHaveLength(1);
    expect(list[0]?.key).toBe("connect-phone");
    expect(list[0]?.subtitle).toBe("Coming soon");
    list[0]?.onSelect();
    expect(onUnsupported).toHaveBeenCalledOnce();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it("does not expose destination pairing actions while unsupported", () => {
    for (const target of ["computer", "cloud", "server"] as const) {
      const { list, onConnect } = items(target, admin);
      expect(list.every((item) => item.key === "connect-phone")).toBe(true);
      expect(onConnect).not.toHaveBeenCalled();
    }
  });

  it("never offers the iOS-only entry it replaced", () => {
    for (const target of ["computer", "server"] as const) {
      expect(items(target, null).list.map((item) => item.label)).not.toContain("Get AIKINGBOT for iOS");
    }
  });
});


describe("choosing where the phone connects", () => {
  const destinations = (account: CloudAccountState | null) => phoneDestinations(connectPhoneEntry("computer", null), cloudPhoneDestination(account));
  const readyCloud: CloudAccountState = { status: "connected", entitlement: { plan: "pro", status: "active", expiresAt: null, version: 1 }, machine: { status: "ready", origin: "https://home-7f3k2.fly.dev" } };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it("to My Cloud opens the Cloud on its phone pairing, as Use My Cloud on your phone does, sending nothing", async () => {
    const bridge = { connectHomeForPhone: vi.fn().mockResolvedValue({ status: "connected" }) };
    const dispatch = vi.fn();
    selectPhoneDestination(destinations(readyCloud)[0]!, { bridge, dispatch });
    await flush();
    expect(bridge.connectHomeForPhone).toHaveBeenCalledExactlyOnceWith();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("when the Cloud cannot be opened, lands on Settings → AIKINGBOT Cloud, which says what to do", async () => {
    const bridge = { connectHomeForPhone: vi.fn().mockRejectedValue(new Error("offline")) };
    const dispatch = vi.fn();
    selectPhoneDestination(destinations(readyCloud)[0]!, { bridge, dispatch });
    await flush();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "toggleAppSettings", open: true, section: "cloudAccount" });
  });

  it("to this computer opens this computer's phone pairing and never touches the Cloud", () => {
    const bridge = { connectHomeForPhone: vi.fn() };
    const dispatch = vi.fn();
    selectPhoneDestination(destinations(readyCloud)[1]!, { bridge, dispatch });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(phonePairingSettingsAction());
    expect(bridge.connectHomeForPhone).not.toHaveBeenCalled();
  });
});

describe("Get the phone app", () => {
  it("offers iPhone and Android with the links the website and Cloud page use", () => {
    expect(PHONE_APPS.map((app) => [app.id, app.url])).toEqual([["ios", IOS_APP_STORE_URL], ["android", ANDROID_APK_URL]]);
    // Store/APK URLs redirect to public docs while mobile apps are gated (Sắp có).
    expect(IOS_APP_STORE_URL).toBe(DOCS_URL);
    expect(ANDROID_APK_URL).toBe(DOCS_URL);
    expect(DOCS_URL).toBe("https://aikingxbot.com/docs/");
  });

  const render = (connect?: PhoneAppConnect[]) => {
    vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
    try {
      return renderToStaticMarkup(createElement(PhoneAppDialog, { open: true, onClose: () => {}, connect }));
    } finally {
      vi.unstubAllGlobals();
    }
  };
  const to = (key: string, subtitle: string): PhoneAppConnect => ({ key, subtitle, onSelect: () => {} });

  it("draws nothing while mobile apps are gated off (Sắp có), including when open with connect destinations", () => {
    // mobileAppsAvailable() === false in product-availability.ts
    expect(render([to("here", "to this computer")])).toBe("");
    expect(render([to("cloud", "to My Cloud (always on)"), to("here", "to this computer")])).toBe("");
    expect(render()).toBe("");
    expect(render([])).toBe("");
  });

  it("is not drawn while closed", () => {
    expect(renderToStaticMarkup(createElement(PhoneAppDialog, { open: false, onClose: () => {} }))).toBe("");
  });
});

describe("profileMenuItems", () => {
  const noop = () => {};
  const build = (patch: Partial<Parameters<typeof profileMenuItems>[0]> = {}) => profileMenuItems({
    phone: [{ key: "phone-app", label: "Get the phone app", onSelect: noop }],
    usage: true,
    update: null,
    account: "AIKINGBOT Cloud",
    onUsage: noop, onSettings: noop, onShortcuts: noop, onAbout: noop, onHelp: noop, onFeedback: noop, onAccount: noop,
    ...patch,
  });

  it("groups usage and the phone, then help and settings, then the account under a divider", () => {
    const items = build();
    expect(items.map((item) => item.key)).toEqual(["usage", "phone-app", "support", "settings", "account"]);
    expect(items.filter((item) => item.separatorBefore).map((item) => item.key)).toEqual(["account"]);
    expect(items.find((item) => item.key === "support")!.submenu!.map((item) => item.key)).toEqual(["help", "feedback", "shortcuts", "about"]);
    expect(items.find((item) => item.key === "account")!.label).toBe("AIKINGBOT Cloud");
  });

  it("only offers what this window has: no usage on a remote server, no account without one", () => {
    const items = build({ usage: false, account: null });
    expect(items.map((item) => item.key)).toEqual(["phone-app", "support", "settings"]);
    expect(items.some((item) => item.separatorBefore)).toBe(false);
  });

  it("keeps the update entry beside settings", () => {
    const update = { key: "update", label: "Check for updates", onSelect: noop };
    expect(build({ update }).map((item) => item.key)).toEqual(["usage", "phone-app", "support", "settings", "update", "account"]);
  });

  it("opens the Usage and account pages of Settings", () => {
    const onUsage = vi.fn(), onAccount = vi.fn();
    const items = build({ onUsage, onAccount });
    items.find((item) => item.key === "usage")!.onSelect();
    items.find((item) => item.key === "account")!.onSelect();
    expect(onUsage).toHaveBeenCalledOnce();
    expect(onAccount).toHaveBeenCalledOnce();
  });
});
