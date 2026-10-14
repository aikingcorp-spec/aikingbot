import {
  DISCORD_CUSTOM_ID_PREFIX,
  type DiscordInboundInteraction,
  type DiscordInboundMessage,
} from "@aikingbot/contracts/signal-protocol/discord-api";
import type { InboundAction, InboundMessage } from "../messaging-types";

/** The actions of the buttons AIKINGBOT posts, as the middle part of their custom id. */
const DISCORD_BUTTON_ACTIONS = ["accept", "decline", "stop"] as const;
type DiscordButtonAction = (typeof DISCORD_BUTTON_ACTIONS)[number];

/**
 * One guild message that mentions AIKINGBOT, as a message for AIKINGBOT. Signal passes on only such
 * messages, with AIKINGBOT's own mention taken out.
 *
 * A conversation is a reply chain, named by its first message. AIKINGBOT replies to that first
 * message with every post, so a reply to an AIKINGBOT post names the first message as `rootId`. A
 * message that does not reply to AIKINGBOT starts a new conversation.
 */
export function discordInboundMessage(message: DiscordInboundMessage): InboundMessage {
  const reply = message.replyTo;
  const threadKey = reply?.authorIsBot ? (reply.rootId ?? reply.messageId) : message.id;
  return {
    dedupKey: `${message.channelId}:${message.id}`,
    platformChannelId: message.channelId,
    threadKey,
    target: { platformChannelId: message.channelId, replyThreadId: threadKey },
    platformMessageId: message.id,
    isDirect: false,
    requiresLink: false,
    authorId: message.authorId,
    text: discordPlainText(message.content),
    mentionedUserIds: discordMentionIds(message.content),
    files: message.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.filename,
      mimeType: attachment.contentType ?? "application/octet-stream",
      size: attachment.size,
      url: attachment.url,
    })),
  };
}

/** One press of an AIKINGBOT button, or null for a custom id that AIKINGBOT did not make. */
export function discordInboundAction(interaction: DiscordInboundInteraction): InboundAction | null {
  if (!interaction.customId.startsWith(DISCORD_CUSTOM_ID_PREFIX)) return null;
  const [action, token, extra] = interaction.customId.slice(DISCORD_CUSTOM_ID_PREFIX.length).split(":");
  if (!token || extra !== undefined || !isButtonAction(action)) return null;
  const common = {
    token,
    actorId: interaction.userId,
    target: { platformChannelId: interaction.channelId, replyThreadId: interaction.replyToId },
    platformMessageId: interaction.messageId,
    replyHandle: interaction.id,
  };
  if (action === "stop") return { type: "stop", ...common };
  return { type: "approval", decision: action, ...common };
}

/** The custom id of one AIKINGBOT button. */
export function discordCustomId(action: DiscordButtonAction, token: string): string {
  return `${DISCORD_CUSTOM_ID_PREFIX}${action}:${token}`;
}

function isButtonAction(value: string | undefined): value is DiscordButtonAction {
  return DISCORD_BUTTON_ACTIONS.some((action) => action === value);
}

/** The users that Discord markup mentions. `discordPlainText` writes each as `@<id>`. */
export function discordMentionIds(text: string): string[] {
  return [...new Set([...text.matchAll(/<@!?([0-9]+)>/g)].map((match) => match[1] ?? ""))].filter(Boolean);
}

/**
 * Discord's markup as plain text: a user, role or channel mention keeps its id, and a custom emoji
 * keeps its name.
 */
export function discordPlainText(text: string): string {
  return text
    .replace(/<@!?([0-9]+)>/g, "@$1")
    .replace(/<@&([0-9]+)>/g, "@role:$1")
    .replace(/<#([0-9]+)>/g, "#$1")
    .replace(/<a?:([A-Za-z0-9_]+):[0-9]+>/g, ":$1:")
    .trim();
}
