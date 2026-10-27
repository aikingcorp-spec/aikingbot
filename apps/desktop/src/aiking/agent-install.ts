// Copyright (c) 2026 AIKING. Creates a configured agent through the same
// path as the upstream New agent dialog (BotCreationDraft + createConfiguredBot):
// profile, memory notes, skills (SKILL.md text, installed offline) and routines.
import { api, type Bot, type ModelSelection } from "@/state/store";
import { BotCreationDraft } from "@/lib/bot-creation-draft";
import { createConfiguredBot } from "@/lib/create-configured-bot";
import type { BotDefaultsProfile, BotRoutineTemplate, BotSkillTemplate, NewBotDefaults } from "../../shared/new-bot-defaults";

export type AgentBlueprint = {
  profile: BotDefaultsProfile;
  memory?: Record<string, string>;
  skills?: BotSkillTemplate[];
  routines?: BotRoutineTemplate[];
};

export type AgentDefaults = { defaults: NewBotDefaults; suggestedName: string };

/** The host's defaults for a new agent, with the default model filled in, as the upstream dialog reads them. */
export async function loadAgentDefaults(): Promise<AgentDefaults> {
  const result = await api<{ defaults: NewBotDefaults; modelSelection: ModelSelection; suggestedName: string }>("/api/bot-defaults");
  const defaults = structuredClone(result.defaults);
  const selection = defaults.profile.modelSelection;
  if (!selection || (selection.instanceId === "" && selection.model === "")) defaults.profile.modelSelection = result.modelSelection;
  return { defaults, suggestedName: result.suggestedName };
}

export class LocalAutoApprovalNeedsConsent extends Error {
  constructor() {
    super("This agent would act on this computer without asking. Open More options to confirm that.");
  }
}

/** Creates the agent; on any failure upstream removes the half-made agent and its routines. */
export async function createAgent(blueprint: AgentBlueprint, base?: AgentDefaults): Promise<{ bot: Bot; warnings: string[] }> {
  const { defaults } = base ?? (await loadAgentDefaults());
  const draft = new BotCreationDraft(
    {
      profile: { ...defaults.profile, ...blueprint.profile },
      memory: { ...defaults.memory, ...blueprint.memory },
      skills: [...defaults.skills, ...(blueprint.skills ?? [])],
      routines: [...defaults.routines, ...(blueprint.routines ?? [])],
    },
    () => {},
  );
  try {
    if (draft.bot.approvalMode === "auto" && draft.bot.computer === "local") throw new LocalAutoApprovalNeedsConsent();
    return await createConfiguredBot(draft);
  } finally {
    draft.dispose();
  }
}
