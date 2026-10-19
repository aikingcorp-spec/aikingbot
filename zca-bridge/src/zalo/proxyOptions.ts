import type { Agent } from "node:http";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

export type ProxyProtocol = "http" | "https" | "socks5";

export interface ProxyConnection {
  protocol: ProxyProtocol;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

/** Options spread into `new Zalo(...)`. `agent` routes the websocket; `polyfill` routes HTTP
 *  (native fetch/undici ignores `agent`, so node-fetch is required for HTTP to traverse the proxy). */
export interface ProxyOptions {
  agent?: Agent;
  polyfill?: typeof fetch;
}

export function proxyUrl(p: ProxyConnection): string {
  const auth = p.username
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password ?? "")}@`
    : "";
  return `${p.protocol}://${auth}${p.host}:${p.port}`;
}

export function buildProxyOptions(proxy: ProxyConnection | null): ProxyOptions {
  if (!proxy) return {};
  const url = proxyUrl(proxy);
  const agent = proxy.protocol === "socks5" ? new SocksProxyAgent(url) : new HttpsProxyAgent(url);
  return { agent: agent as unknown as Agent, polyfill: nodeFetch as unknown as typeof fetch };
}
