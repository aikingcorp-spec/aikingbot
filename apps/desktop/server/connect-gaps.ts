// 2.2: a service the person added but has not signed in to stays visible to the bot as "Kết nối dịch vụ X", instead of vanishing from its tools.
import type { McpServerSpec } from "./contracts.ts";

export interface SignInStates { authState(name: string, url: string): string }

export function pendingSignInServices(servers: Record<string, McpServerSpec>, manager: SignInStates): string[] {
  return Object.entries(servers)
    .filter(([name, server]) => "url" in server && manager.authState(name, server.url) === "needs-sign-in")
    .map(([name]) => name)
    .sort();
}

export function connectGapsPrompt(names: readonly string[]): string {
  if (!names.length) return "";
  const list = names.slice(0, 20).map((name) => `- Kết nối dịch vụ ${name} (not signed in yet; its tools are hidden until then)`).join("\n");
  return `Services the person added but has not connected:\n${list}\nWhen a task needs one of them, call request_connect with its name: the person connects it from a card in this chat. Do not send them to Settings and do not pretend its tools exist.`;
}
