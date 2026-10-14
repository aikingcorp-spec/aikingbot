// The one list of published guides. Same shape as the news registry, and read by
// the same pages, feed, sitemap and image generator.
//
// The public guides explain how AIKINGBOT works and how to use it. Contributor
// instructions for adding a guide live in CONTRIBUTING.md instead.

import { type ContentCollection, publishedFirst } from "./content-collection";
import { NEWS_AUTHOR } from "./news";

export const GUIDES_COLLECTION: ContentCollection<"guides"> = {
  id: "guides",
  indexRoute: "/guides",
  articleRoute: "/guides/$slug",
  name: "Guides",
  indexTitle: "AIKINGBOT Guides: How to Run a Team of AI Agents",
  indexDescription:
    "How AIKINGBOT works and how to run a team of AI agents. Start with AIKINGBOT 101, then explore practical guides to models, agents, and the Marketplace.",
  feedTitle: "AIKINGBOT guides",
  backLabel: "All guides",
  moreTitle: "More guides",
  imageEyebrow: "AIKINGBOT · GUIDES",
  articles: publishedFirst([
    {
      slug: "aikingbot-hosted-servers",
      title: "AIKINGBOT Hosted Servers: Plans, Pricing, and How They Work",
      description:
        "Compare AIKINGBOT hosted server plans, pricing, storage, and team limits. Learn how to set one up and when self-hosting may suit you better.",
      publishedAt: "2026-10-07",
      author: NEWS_AUTHOR,
    },
    {
      slug: "aikingbot-marketplace",
      title: "How to Use the AIKINGBOT Marketplace: Agents, Skills, and Plugins",
      description:
        "Browse the AIKINGBOT Marketplace, install agents, plugins, and skills, and submit your own agent for review.",
      publishedAt: "2026-09-29",
      author: NEWS_AUTHOR,
    },
    {
      slug: "what-are-ai-agents",
      title: "What Are AI Agents? How They Work and When to Use Them",
      description:
        "What are AI agents, how do they work, and when are they useful? A practical guide to their tools, use cases, and limits.",
      publishedAt: "2026-09-24",
      author: NEWS_AUTHOR,
    },
    {
      slug: "aikingbot-101",
      title: "AIKINGBOT 101",
      description:
        "What AIKINGBOT is, what an agent keeps between runs, and how to get one doing real work on your computer. Start here if you have not opened the app yet.",
      publishedAt: "2026-09-12",
      author: NEWS_AUTHOR,
    },
    {
      slug: "wtf-is-aikingbot",
      title: "WTF Is AIKINGBOT?",
      description:
        "A practical explanation of models, providers, agents, and the local-first workspace that brings them together.",
      publishedAt: "2026-09-15",
      author: NEWS_AUTHOR,
    },
  ]),
};
