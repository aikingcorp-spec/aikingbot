// Copyright (c) 2026 AIKING.
// Apps connected through their makers' own MCP servers and OAuth. Endpoints and sign-in support checked against each
// server's OAuth metadata on 2026-10-16: Linear, Notion and Stripe register a workspace themselves (RFC 7591);
// GitHub, Slack, HubSpot, Discord and Google sign in only apps registered in advance, so the owner registers one
// sign-in app with that provider once. Composio stays as the fallback where it supports the app.

type OfficialApp = {
  slug: string; name: string; summary: string; category: string; url: string;
  signIn: "automatic" | "app"; scopes?: string[]; composio?: string;
  /** Vietnamese summary; the category label comes from APP_CATEGORY_VI. */
  summaryVi: string;
  provider?: { name: string; setupUrl: string; steps: string[] };
};

/** Vietnamese labels for the app categories (the English name stays the filter key). */
export const APP_CATEGORY_VI: Record<string, string> = {
  "Developer tools": "Công cụ lập trình", Productivity: "Năng suất", Communication: "Giao tiếp", Data: "Dữ liệu",
  Files: "Tệp", Sales: "Bán hàng", Design: "Thiết kế", Research: "Nghiên cứu",
};

/** The `locales` field for an app listing. */
export function appLocales(summaryVi: string, category: string) {
  return { vi: { summary: summaryVi, ...(APP_CATEGORY_VI[category] ? { category: APP_CATEGORY_VI[category] } : {}) } };
}

const google = (apis: string): OfficialApp["provider"] => ({
  name: "Google Cloud",
  setupUrl: "https://console.cloud.google.com/apis/credentials",
  steps: [
    `In a Google Cloud project, enable ${apis}.`,
    "Configure the OAuth consent screen (Internal for a Workspace domain; External with test users otherwise).",
    "Create credentials → OAuth client ID → Web application, and add the redirect URI shown below.",
    "Paste the client ID and secret here. One Google client can serve Gmail, Calendar, Drive and Sheets.",
  ],
});

const APPS: OfficialApp[] = [
  { slug: "github", summaryVi: "Kho mã, issue và pull request", name: "GitHub", summary: "Repositories, issues and pull requests", category: "Developer tools", url: "https://api.githubcopilot.com/mcp/", signIn: "app", composio: "github",
    scopes: ["repo", "read:org", "read:user", "user:email", "notifications"],
    provider: { name: "GitHub", setupUrl: "https://github.com/settings/applications/new", steps: [
      "Register a new OAuth app (for an organization: Organization settings → Developer settings → OAuth Apps).",
      "Homepage URL: this workspace's address. Authorization callback URL: the redirect URI shown below.",
      "Generate a client secret, then paste the client ID and secret here.",
    ] } },
  { slug: "linear", summaryVi: "Issue, chu kỳ và tiến độ dự án", name: "Linear", summary: "Issues, cycles and project status", category: "Productivity", url: "https://mcp.linear.app/mcp", signIn: "automatic", composio: "linear" },
  { slug: "notion", summaryVi: "Trang và cơ sở dữ liệu", name: "Notion", summary: "Pages and databases", category: "Productivity", url: "https://mcp.notion.com/mcp", signIn: "automatic", composio: "notion" },
  { slug: "gmail", summaryVi: "Đọc và gửi email", name: "Gmail", summary: "Read and send email", category: "Communication", url: "https://gmailmcp.googleapis.com/mcp/v1", signIn: "app", composio: "gmail",
    scopes: ["https://www.googleapis.com/auth/gmail.modify"], provider: google("the Gmail API") },
  { slug: "googlecalendar", summaryVi: "Xem và tạo sự kiện", name: "Google Calendar", summary: "Read and create events", category: "Productivity", url: "https://calendarmcp.googleapis.com/mcp/v1", signIn: "app", composio: "googlecalendar",
    scopes: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"], provider: google("the Google Calendar API") },
  { slug: "googlesheets", summaryVi: "Đọc và cập nhật bảng tính", name: "Google Sheets", summary: "Read and update spreadsheets", category: "Data", url: "https://sheetsmcp.googleapis.com/mcp/v1", signIn: "app", composio: "googlesheets",
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.readonly"], provider: google("the Google Sheets API and the Google Drive API") },
  { slug: "googledrive", summaryVi: "Tìm và chia sẻ tệp", name: "Google Drive", summary: "Find and share files", category: "Files", url: "https://drivemcp.googleapis.com/mcp/v1", signIn: "app", composio: "googledrive",
    scopes: ["https://www.googleapis.com/auth/drive"], provider: google("the Google Drive API") },
  { slug: "slack", summaryVi: "Đăng cập nhật và đọc kênh", name: "Slack", summary: "Post updates and read channels", category: "Communication", url: "https://mcp.slack.com/mcp", signIn: "app", composio: "slack",
    scopes: ["search:read.public", "channels:read", "channels:history", "chat:write", "users:read", "im:read", "im:history"],
    provider: { name: "Slack", setupUrl: "https://api.slack.com/apps?new_app=1", steps: [
      "Create a Slack app for your workspace.",
      "OAuth & Permissions: add the redirect URI shown below and the user token scopes listed here.",
      "Turn on the Slack MCP server for the app if Slack asks for it, then paste the client ID and secret here.",
    ] } },
  { slug: "discord", summaryVi: "Tin nhắn và kênh", name: "Discord", summary: "Messages and channels", category: "Communication", url: "https://mcp.discord.com/mcp", signIn: "app", composio: "discord",
    scopes: ["identify", "guilds", "guilds.members.read", "personal.guilds.channels.read", "personal.guilds.channels.messages.read", "personal.guilds.messages.search", "personal.mentions.read"],
    provider: { name: "Discord", setupUrl: "https://discord.com/developers/applications", steps: [
      "Create an application, open OAuth2 and add the redirect URI shown below.",
      "Copy the client ID and reset/copy the client secret, then paste both here.",
    ] } },
  { slug: "hubspot", summaryVi: "Liên hệ, giao dịch và quy trình bán hàng", name: "HubSpot", summary: "Contacts, deals and pipelines", category: "Sales", url: "https://mcp.hubspot.com/", signIn: "app", composio: "hubspot",
    provider: { name: "HubSpot", setupUrl: "https://developers.hubspot.com/mcp", steps: [
      "In a HubSpot developer project, create an MCP auth app and choose the CRM scopes the agent may use.",
      "Add the redirect URI shown below, then paste the app's client ID and secret here.",
    ] } },
  { slug: "stripe", summaryVi: "Thanh toán, khách hàng và hóa đơn", name: "Stripe", summary: "Payments, customers and invoices", category: "Sales", url: "https://mcp.stripe.com", signIn: "automatic", composio: "stripe" },
];

export const OFFICIAL_APPS = APPS.map((app) => ({
  kind: "app" as const, id: app.slug, version: "2.0.0", name: app.name, summary: app.summary, category: app.category,
  locales: appLocales(app.summaryVi, app.category),
  tags: ["official", "oauth"], logo: app.slug, publisher: { id: app.slug, name: app.name, verified: true }, installs: 0,
  connector: {
    type: "official" as const, server: { type: "http" as const, name: app.slug, url: app.url }, signIn: app.signIn,
    ...(app.provider ? { provider: app.provider } : {}), ...(app.scopes ? { scopes: app.scopes } : {}), ...(app.composio ? { composio: app.composio } : {}),
  },
}));
