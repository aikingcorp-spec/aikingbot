// Slug to guide body, on the same terms as the news bodies: eager, so the prose
// is in the server's HTML rather than arriving after hydration.

import type { ArticleBody } from "../body";
import { AIKINGBOT101 } from "./aikingbot-101";
import { AIKINGBOTHostedServers } from "./aikingbot-hosted-servers";
import { AIKINGBOTMarketplace } from "./aikingbot-marketplace";
import { WhatAreAIAgents } from "./what-are-ai-agents";
import { WtfIsAIKINGBOT } from "./wtf-is-aikingbot";

export const GUIDE_BODIES: Readonly<Record<string, ArticleBody>> = {
  "what-are-ai-agents": WhatAreAIAgents,
  "aikingbot-101": AIKINGBOT101,
  "aikingbot-hosted-servers": AIKINGBOTHostedServers,
  "aikingbot-marketplace": AIKINGBOTMarketplace,
  "wtf-is-aikingbot": WtfIsAIKINGBOT,
};
