import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { registerWebhookRoute } from "../../src/chatwoot/webhookServer.js";

const outgoingBody = {
  event: "message_created",
  message_type: "outgoing",
  private: false,
  content: "Hello from agent",
  id: 999,
  conversation: {
    id: 10,
    inbox_id: 5,
    contact_inbox: { source_id: "user:12345" },
  },
  inbox: { id: 5 },
  attachments: [],
};

function buildApp(secret: string | null = null) {
  const app = Fastify({ logger: false });
  const onOutgoing = vi.fn(async () => {});
  registerWebhookRoute(app, onOutgoing, secret);
  return { app, onOutgoing };
}

describe("registerWebhookRoute — no secret", () => {
  it("POST /webhooks/chatwoot handles an outgoing message", async () => {
    const { app, onOutgoing } = buildApp(null);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/chatwoot",
      payload: outgoingBody,
    });
    expect(res.statusCode).toBe(200);
    expect(onOutgoing).toHaveBeenCalledOnce();
  });
});

describe("registerWebhookRoute — with secret", () => {
  const SECRET = "abc123secret";

  it("POST /webhooks/chatwoot/<secret> returns 200 and calls onOutgoing", async () => {
    const { app, onOutgoing } = buildApp(SECRET);
    const res = await app.inject({
      method: "POST",
      url: `/webhooks/chatwoot/${SECRET}`,
      payload: outgoingBody,
    });
    expect(res.statusCode).toBe(200);
    expect(onOutgoing).toHaveBeenCalledOnce();
  });

  it("POST /webhooks/chatwoot (without secret in path) returns 404 when secret is configured", async () => {
    const { app } = buildApp(SECRET);
    const res = await app.inject({
      method: "POST",
      url: "/webhooks/chatwoot",
      payload: outgoingBody,
    });
    expect(res.statusCode).toBe(404);
  });
});
