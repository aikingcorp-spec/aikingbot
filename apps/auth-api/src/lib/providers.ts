// The one list of provider pages: what AIKINGBOT does with each coding agent it runs.
// Like the comparisons, the sitemap, the feed, the head tags and the build-time
// image generator read it, and the page is drawn from the data in src/content/providers.
//
// No JSX here, for the same reason `content-collection.ts` holds none.

import { type ContentCollection, publishedFirst } from "./content-collection";
import { NEWS_AUTHOR } from "./news";

export const PROVIDERS_COLLECTION: ContentCollection<"providers"> = {
  id: "providers",
  indexRoute: "/providers",
  articleRoute: "/providers/$slug",
  name: "Providers",
  indexTitle: "AI coding agents that AIKINGBOT runs",
  indexDescription:
    "Claude Code, Codex, Gemini, Grok, Cursor, OpenCode, Cline and local models in one desktop app: how to set each one up, and what AIKINGBOT adds to it.",
  feedTitle: "AIKINGBOT providers",
  backLabel: "All providers",
  moreTitle: "More providers",
  imageEyebrow: "AIKINGBOT · PROVIDERS",
  articles: publishedFirst([
    {
      slug: "claude-code",
      title: "Claude Code GUI: Run Claude Code in a Desktop App",
      description:
        "Run Claude Code in AIKINGBOT on macOS, Windows or Linux. Sign in with your Claude plan, then give it a team, shared channels and an app on your phone.",
      publishedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "codex",
      title: "Codex Desktop App for macOS, Windows and Linux",
      description:
        "Run OpenAI Codex in AIKINGBOT on macOS, Windows or Linux. Sign in with ChatGPT, then give Codex a team, shared channels and an app on your phone.",
      publishedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "gemini",
      title: "Gemini Agent Desktop App: Run Gemini in AIKINGBOT",
      description:
        "Run the Gemini coding agent in AIKINGBOT on macOS, Windows or Linux. Sign in with Google, then give it a team, shared channels and an app on your phone.",
      publishedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "grok",
      title: "Grok CLI GUI: Run the Grok Coding Agent in AIKINGBOT",
      description:
        "Run the Grok coding agent in AIKINGBOT on macOS, Windows or Linux. Sign in with xAI, then give it a team, shared channels and an app on your phone.",
      publishedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "cursor",
      title: "Cursor CLI GUI: Run the Cursor Agent in AIKINGBOT",
      description:
        "Run the Cursor agent outside the editor, in AIKINGBOT on macOS, Windows or Linux. Give it a team, shared channels and an app on your phone.",
      publishedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "opencode",
      title: "OpenCode GUI: Run OpenCode and Its Free Models in AIKINGBOT",
      description:
        "Run OpenCode in AIKINGBOT on macOS, Windows or Linux, with its free models and no account. Give it a team, shared channels and an app on your phone.",
      publishedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "cline",
      title: "Cline Desktop App: Run Cline Without an Editor in AIKINGBOT",
      description:
        "Run the Cline agent without an editor, in AIKINGBOT on macOS, Windows or Linux. Give it a team, shared channels and an app on your phone.",
      publishedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
    {
      slug: "local-models",
      title: "Ollama and LM Studio Agent App: Run Local Models in AIKINGBOT",
      description:
        "Run a coding agent on a model from Ollama or LM Studio, in AIKINGBOT on macOS, Windows or Linux. The model and your files stay on your computer.",
      publishedAt: "2026-10-03",
      author: NEWS_AUTHOR,
    },
  ]),
};
