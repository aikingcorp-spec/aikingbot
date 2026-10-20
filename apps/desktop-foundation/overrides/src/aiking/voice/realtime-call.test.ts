// Copyright (c) 2026 AIKING.
import { describe, expect, it } from "vitest";
import { setLocale } from "../../lib/i18n";
import { voiceUnavailableMessage, reduceEvents } from "./realtime-call";
import { voiceLabel } from "./RealtimeCodexCall";

describe("realtime call widget state", () => {
  const empty = { working: null, lastResult: null, error: "" };
  it("shows the agent working until its answer, and keeps a failure", () => {
    const working = reduceEvents(empty, [{ seq: 1, type: "transcript", role: "user", text: "List my files" }, { seq: 2, type: "agent-working", request: "List my files" }]);
    expect(working).toEqual({ working: "List my files", lastResult: null, error: "" });
    expect(reduceEvents(working, [{ seq: 3, type: "agent-done", ok: true, summary: "Zero files." }])).toEqual({ working: null, lastResult: { ok: true, summary: "Zero files." }, error: "" });
    expect(reduceEvents(working, [{ seq: 3, type: "agent-done", ok: false, summary: "busy" }, { seq: 4, type: "error", message: "lost" }])).toMatchObject({ working: null, lastResult: { ok: false }, error: "lost" });
  });
  it("labels voices", () => {
    expect(voiceLabel("cedar")).toBe("Cedar");
    expect(voiceLabel("")).toBe("Default");
  });
});

it("updates unsupported-model voice text when the person changes language", () => {
  try {
    setLocale("vi-VN");
    expect(voiceUnavailableMessage()).toBe("Mô hình này chưa hỗ trợ gọi thoại.");
    setLocale("en");
    expect(voiceUnavailableMessage()).toBe("Voice is not available for this model.");
  } finally { setLocale("en"); }
});
