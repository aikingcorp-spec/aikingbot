# AIKINGBOT

AIKINGBOT is a desktop app for working with a team of AI agents. The agents, their CLIs, memory and files live on the person's own
computer; the web is a remote control for that computer.

| Path | What it is |
| --- | --- |
| `apps/desktop` | The product: Electron app, local server, interface, companion. Windows and Linux. |
| `apps/web-remote` | Cloudflare Worker for the web client: sign-in, choosing a computer, passing requests to it. |
| `apps/site` | Cloudflare Worker for the public site, plus the website build (`apps/site/website`). |
| `apps/platform` | Gateway and provisioner of the staging environment. |
| `packages/core` | AIKING Core: chat, agent runtime, MCP tools, skills (embedded into the desktop app). |
| `infrastructure` | Server image and web edge definitions. |
| `scripts` | Build, packaging and verification tools. |
| `tests` | The release gate (`tests/manifest.json`). |

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) to build and test.
