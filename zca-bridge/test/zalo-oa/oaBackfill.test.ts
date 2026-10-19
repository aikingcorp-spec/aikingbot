import { describe, it, expect, vi } from "vitest";
import { runBackfill, DEFAULT_CAPS } from "../../src/zalo-oa/oaBackfill.js";

// Build a fake client from a map of userId -> messages (newest first).
function fakeClient(recent: { userId: string; lastTimeMs: number }[], byUser: Record<string, any[]>) {
  return {
    listRecentChat: vi.fn(async (_oaId: string, offset: number, count: number) => recent.slice(offset, offset + count)),
    getConversationMessages: vi.fn(async (userId: string, offset: number, count: number) => (byUser[userId] ?? []).slice(offset, offset + count)),
  };
}

const caps = { ...DEFAULT_CAPS, pageSize: 10 };

describe("runBackfill", () => {
  it("enqueues only messages newer than the watermark and reports the max time", async () => {
    const client = fakeClient(
      [{ userId: "u1", lastTimeMs: 300 }],
      { u1: [
        { message_id: "m3", src: 1, time: 300, type: "text", message: "new2" },
        { message_id: "m2", src: 1, time: 200, type: "text", message: "new1" },
        { message_id: "m1", src: 1, time: 100, type: "text", message: "old" }, // <= watermark 150 -> stop
      ] },
    );
    const enqueued: string[] = [];
    const res = await runBackfill(client as any, "OA1", 150, (m) => enqueued.push(m.msgId), caps);
    expect(enqueued).toEqual(["m3", "m2"]);
    expect(res.maxTimeMs).toBe(300);
    expect(res.enqueued).toBe(2);
  });

  it("skips conversations not newer than the watermark but keeps scanning later ones (no early cross-conversation stop)", async () => {
    const client = fakeClient(
      [ // deliberately UNSORTED: an old conversation appears before a new one
        { userId: "uOld", lastTimeMs: 100 },
        { userId: "uNew", lastTimeMs: 500 },
      ],
      {
        uOld: [{ message_id: "old1", src: 1, time: 100, type: "text", message: "x" }],
        uNew: [{ message_id: "new1", src: 1, time: 500, type: "text", message: "y" }],
      },
    );
    const enqueued: string[] = [];
    await runBackfill(client as any, "OA1", 200, (m) => enqueued.push(m.msgId), caps);
    expect(enqueued).toEqual(["new1"]);
    expect(client.getConversationMessages).not.toHaveBeenCalledWith("uOld", expect.anything(), expect.anything());
  });

  it("recovers a brand-new customer's message (no prior bridge state)", async () => {
    const client = fakeClient(
      [{ userId: "stranger", lastTimeMs: 900 }],
      { stranger: [{ message_id: "s1", src: 1, time: 900, type: "text", message: "first ever" }] },
    );
    const enqueued: string[] = [];
    const res = await runBackfill(client as any, "OA1", 800, (m) => enqueued.push(m.msgId), caps);
    expect(enqueued).toEqual(["s1"]);
    expect(res.enqueued).toBe(1);
  });

  it("respects maxMessagesPerConversation and sets capped", async () => {
    const msgs = Array.from({ length: 5 }, (_, i) => ({ message_id: `m${i}`, src: 1, time: 1000 - i, type: "text", message: String(i) }));
    const client = fakeClient([{ userId: "u1", lastTimeMs: 1000 }], { u1: msgs });
    const enqueued: string[] = [];
    const res = await runBackfill(client as any, "OA1", 0, (m) => enqueued.push(m.msgId), { maxConversations: 50, maxMessagesPerConversation: 3, pageSize: 10 });
    expect(enqueued.length).toBe(3);
    expect(res.capped).toBe(true);
  });

  it("respects maxConversations", async () => {
    const recent = Array.from({ length: 4 }, (_, i) => ({ userId: `u${i}`, lastTimeMs: 1000 }));
    const byUser: Record<string, any[]> = {};
    for (const r of recent) byUser[r.userId] = [{ message_id: `x${r.userId}`, src: 1, time: 1000, type: "text", message: "h" }];
    const client = fakeClient(recent, byUser);
    const enqueued: string[] = [];
    const res = await runBackfill(client as any, "OA1", 0, (m) => enqueued.push(m.msgId), { maxConversations: 2, maxMessagesPerConversation: 100, pageSize: 10 });
    expect(enqueued.length).toBe(2);
    expect(res.capped).toBe(true);
  });
});
