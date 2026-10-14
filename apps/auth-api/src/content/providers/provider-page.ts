import type { LandingIconName } from "../../components/landing/LandingIcon";
import type { AIKINGBOTPlan, ComparisonQuestion, ComparisonSource } from "../compare/comparison";

// One provider page, as data: what AIKINGBOT does with one coding agent it runs. The
// page draws every part from it, and the FAQ structured data is built from the same
// questions, so the two can not disagree.

/** One thing that AIKINGBOT adds to the provider's own agent. */
export interface ProviderAdd {
  icon: LandingIconName;
  title: string;
  text: string;
}

/** One app that the provider's company ships itself. */
interface ProviderOfficialApp {
  name: string;
  platforms: string;
  /** What it is for, or what it needs. */
  note: string;
}

export interface ProviderPage {
  /** The logo of the plan card to light, and of the hero. `custom` is a model server of your own. */
  provider: AIKINGBOTPlan["provider"];
  /** The product's own spelling, as the page names it. */
  name: string;
  /** The one-sentence answer under the title. */
  answer: string;
  /** How AIKINGBOT connects to the provider: the second setup step. */
  connect: string;
  /** What AIKINGBOT adds for this provider in particular, shown before `AIKINGBOT_ADDS`. */
  adds: readonly ProviderAdd[];
  /** The company that makes the provider, as in "{vendor}'s own apps". */
  vendor: string;
  officialApps: readonly ProviderOfficialApp[];
  /** Slugs of the /compare pages about this provider. */
  comparisons: readonly string[];
  faq: readonly ComparisonQuestion[];
  sources: readonly ComparisonSource[];
  /** `YYYY-MM-DD`: the day every claim about the provider was last checked against its sources. */
  checkedAt: string;
}

/**
 * What AIKINGBOT adds to every provider. The claims are the same as on the compare
 * pages (`content/compare/claude-cowork.ts`), and come from the repository.
 */
export const AIKINGBOT_ADDS: readonly ProviderAdd[] = [
  {
    icon: "users",
    title: "A team, not one chat",
    text: "Each agent has its own job and workspace. A lead agent gives parts of a task to other agents in a shared channel, and you step in when a decision needs you.",
  },
  {
    icon: "phone",
    title: "Your agents on your phone",
    text: "The AIKINGBOT apps for iPhone and Android connect to the computer that runs your agents, over an encrypted connection, with no VPN. Remote access needs an AIKINGBOT account.",
  },
  {
    icon: "blocks",
    title: "Change the provider, keep the work",
    text: "Move an agent to a different provider and it keeps its role, workspace and conversation. Agents on different providers work in the same channel.",
  },
  {
    icon: "lock",
    title: "Your data on your computer",
    text: "Workspaces, chats and files stay on the computer that runs AIKINGBOT. The provider you choose gets the requests you send.",
  },
  {
    icon: "tag",
    title: "Use your AI plans",
    text: "AIKINGBOT is free for noncommercial use. Your agents use the plans you already pay for.",
  },
];
