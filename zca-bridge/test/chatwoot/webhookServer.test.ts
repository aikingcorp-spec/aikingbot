import { describe, it, expect } from "vitest";
import { parseOutgoingWebhook } from "../../src/chatwoot/webhookServer.js";

describe("parseOutgoingWebhook", () => {
  const outgoing = {
    event: "message_created",
    message_type: "outgoing",
    private: false,
    content: "Hello from agent",
    id: 555,
    conversation: {
      id: 42,
      inbox_id: 3,
      contact_inbox: { source_id: "user:84900" },
    },
    inbox: { id: 3 },
    attachments: [],
  };

  it("returns a normalized event for an outgoing message", () => {
    const parsed = parseOutgoingWebhook(outgoing);
    expect(parsed).toEqual({
      sourceId: "user:84900",
      content: "Hello from agent",
      chatwootMessageId: 555,
      inboxId: 3,
      attachments: [],
    });
  });

  it("captures in_reply_to from content_attributes when the agent replies to a message", () => {
    const parsed = parseOutgoingWebhook({ ...outgoing, content_attributes: { in_reply_to: 321 } });
    expect(parsed?.inReplyTo).toBe(321);
  });

  it("omits inReplyTo when there is no reply", () => {
    expect(parseOutgoingWebhook(outgoing)).not.toHaveProperty("inReplyTo");
  });

  it("ignores incoming messages", () => {
    expect(parseOutgoingWebhook({ ...outgoing, message_type: "incoming" })).toBeNull();
  });

  it("ignores private notes", () => {
    expect(parseOutgoingWebhook({ ...outgoing, private: true })).toBeNull();
  });

  it("ignores non message_created events", () => {
    expect(parseOutgoingWebhook({ ...outgoing, event: "conversation_status_changed" })).toBeNull();
  });

  it("collects attachment data_urls", () => {
    const withAtt = { ...outgoing, attachments: [{ data_url: "http://x/a.jpg", file_type: "image" }] };
    expect(parseOutgoingWebhook(withAtt)?.attachments).toEqual([{ dataUrl: "http://x/a.jpg", fileType: "image" }]);
  });

  // Real Chatwoot message_created payloads carry inbox_id only inside
  // conversation.contact_inbox — no conversation.inbox_id, no top-level inbox.
  it("reads inbox_id from conversation.contact_inbox when no other inbox field exists", () => {
    const realShape = {
      event: "message_created",
      message_type: "outgoing",
      private: false,
      content: "test 123",
      id: 777,
      conversation: {
        id: 1,
        contact_inbox: { id: 1, contact_id: 1, inbox_id: 2, source_id: "user:2559672430342412971" },
      },
      attachments: [],
    };
    expect(parseOutgoingWebhook(realShape)).toEqual({
      sourceId: "user:2559672430342412971",
      content: "test 123",
      chatwootMessageId: 777,
      inboxId: 2,
      attachments: [],
    });
  });
});
