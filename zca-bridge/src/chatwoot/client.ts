import { request } from "undici";
import { buildMultipart } from "./multipart.js";

export interface CreateContactInput {
  sourceId: string;
  name: string;
  avatarUrl?: string;
  phoneNumber?: string;
}

export interface Attachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export class ChatwootClient {
  constructor(private baseUrl: string) {}

  private inboxPath(identifier: string): string {
    return `${this.baseUrl}/public/api/v1/inboxes/${identifier}`;
  }

  async createContact(
    identifier: string,
    input: CreateContactInput
  ): Promise<{ sourceId: string }> {
    const res = await request(`${this.inboxPath(identifier)}/contacts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source_id: input.sourceId,
        name: input.name,
        avatar_url: input.avatarUrl,
        phone_number: input.phoneNumber,
      }),
    });
    if (res.statusCode >= 400) { res.body.dump(); throw new Error(`createContact failed: ${res.statusCode}`); }
    const body = (await res.body.json()) as { source_id: string };
    return { sourceId: body.source_id };
  }

  async updateContact(
    identifier: string,
    sourceId: string,
    fields: { name?: string; avatarUrl?: string; phoneNumber?: string; customAttributes?: Record<string, string> }
  ): Promise<void> {
    const res = await request(`${this.inboxPath(identifier)}/contacts/${sourceId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: fields.name,
        avatar_url: fields.avatarUrl,
        phone_number: fields.phoneNumber,
        custom_attributes: fields.customAttributes,
      }),
    });
    if (res.statusCode >= 400) throw new Error(`updateContact failed: ${res.statusCode}`);
    res.body.dump();
  }

  async getContact(
    identifier: string,
    sourceId: string
  ): Promise<{ sourceId: string } | null> {
    const res = await request(
      `${this.inboxPath(identifier)}/contacts/${sourceId}`,
      { method: "GET" }
    );
    if (res.statusCode === 404) {
      res.body.dump();
      return null;
    }
    if (res.statusCode >= 400) { res.body.dump(); throw new Error(`getContact failed: ${res.statusCode}`); }
    res.body.dump();
    return { sourceId };
  }

  async createConversation(
    identifier: string,
    sourceId: string
  ): Promise<{ id: number }> {
    const res = await request(
      `${this.inboxPath(identifier)}/contacts/${sourceId}/conversations`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
    );
    if (res.statusCode >= 400) { res.body.dump(); throw new Error(`createConversation failed: ${res.statusCode}`); }
    return (await res.body.json()) as { id: number };
  }

  async createMessage(
    identifier: string,
    sourceId: string,
    conversationId: number,
    input: { content: string; attachments?: Attachment[] }
  ): Promise<{ id: number }> {
    const url = `${this.inboxPath(identifier)}/contacts/${sourceId}/conversations/${conversationId}/messages`;

    if (input.attachments && input.attachments.length > 0) {
      const { body, contentType } = buildMultipart(
        { content: input.content ?? "" },
        input.attachments.map((a) => ({ name: "attachments[]", filename: a.filename, contentType: a.contentType, content: a.content })),
      );
      const res = await request(url, {
        method: "POST",
        headers: { "content-type": contentType, "content-length": String(body.length) },
        body,
      });
      if (res.statusCode >= 400) { res.body.dump(); throw new Error(`createMessage(attachment) failed: ${res.statusCode}`); }
      return (await res.body.json()) as { id: number };
    }

    const res = await request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: input.content }),
    });
    if (res.statusCode >= 400) { res.body.dump(); throw new Error(`createMessage failed: ${res.statusCode}`); }
    return (await res.body.json()) as { id: number };
  }
}
