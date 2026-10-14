// The seam that lets one memories modal serve an agent and a channel.
//
// Everything the modal renders is owner-agnostic; only the five calls, the event filter and three
// words of copy are not. They live here, so `AgentMemoriesModal` names no owner at all.

import { INPUT_LIMITS } from "@aikingbot/contracts/input-limits";
import type {
  AgentMemorySelectionState,
  AIKINGBOTDesktopApi,
  MemoryEntry,
  SetAgentMemoryInclusionInput,
} from "@aikingbot/contracts/ipc";

export interface MemoriesPort {
  ownerId: string;
  /** The name the modal shows the user, such as `Chief` or `Project Falcon`. */
  ownerLabel: string;
  /** The word the modal reads in its sentences: "This agent has no saved memories yet." */
  ownerNoun: "agent" | "channel";
  /** Null when another computer holds the cap: its host refuses a memory past it. */
  limit: number | null;
  list: () => Promise<MemoryEntry[]>;
  selection?: {
    read: () => Promise<AgentMemorySelectionState | null>;
    set: (changes: SetAgentMemoryInclusionInput["changes"]) => Promise<AgentMemorySelectionState>;
  };
  create: (text: string) => Promise<void>;
  update: (memoryId: string, text: string) => Promise<void>;
  remove: (memoryId: string) => Promise<void>;
  clear: () => Promise<void>;
  /** Returns the unsubscribe function. The owner-id filter belongs to the port, not the modal. */
  subscribe: (reload: () => void) => () => void;
}

export function agentMemoriesPort(agentId: string, agentName: string, limit: number | null): MemoriesPort {
  return {
    ownerId: agentId,
    ownerLabel: agentName,
    ownerNoun: "agent",
    limit,
    list: () => window.aikingbot.agent.listMemories(agentId),
    selection: {
      read: () => window.aikingbot.agent.getMemorySelection(agentId),
      set: (changes) => window.aikingbot.agent.setMemoryInclusion({ agentId, changes }),
    },
    create: async (text) => {
      await window.aikingbot.agent.createMemory({ agentId, text });
    },
    update: async (memoryId, text) => {
      await window.aikingbot.agent.updateMemory({ agentId, memoryId, text });
    },
    remove: (memoryId) => window.aikingbot.agent.deleteMemory({ agentId, memoryId }),
    clear: () => window.aikingbot.agent.clearMemories(agentId),
    subscribe: (reload) =>
      window.aikingbot.agent.onEvent((event) => {
        if (event.type === "memories-changed" && event.agentId === agentId) reload();
      }),
  };
}

/** The host calls a channel's memories make. The desktop sends them through preload. */
export type ChannelMemoriesApi = Pick<
  AIKINGBOTDesktopApi["agent"],
  | "listChannelMemories"
  | "createChannelMemory"
  | "updateChannelMemory"
  | "deleteChannelMemory"
  | "clearChannelMemories"
  | "onEvent"
>;

export function channelMemoriesPort(
  channelId: string,
  channelName: string,
  api: ChannelMemoriesApi = window.aikingbot.agent,
): MemoriesPort {
  return {
    ownerId: channelId,
    ownerLabel: channelName,
    ownerNoun: "channel",
    limit: INPUT_LIMITS.channelMemories,
    list: () => api.listChannelMemories(channelId),
    create: async (text) => {
      await api.createChannelMemory({ channelId, text });
    },
    update: async (memoryId, text) => {
      await api.updateChannelMemory({ channelId, memoryId, text });
    },
    remove: (memoryId) => api.deleteChannelMemory({ channelId, memoryId }),
    clear: () => api.clearChannelMemories(channelId),
    subscribe: (reload) =>
      api.onEvent((event) => {
        if (event.type === "channel-memories-changed" && event.channelId === channelId) reload();
      }),
  };
}
