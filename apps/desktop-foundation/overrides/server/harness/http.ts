import type { IncomingMessage, ServerResponse } from "node:http";

const jsonHooks = new WeakMap<ServerResponse, (body: unknown) => unknown>();
const parsedBodies = new WeakMap<IncomingMessage, unknown>();

export function onJsonBody(res: ServerResponse, hook: (body: unknown) => unknown): void {
  const previous = jsonHooks.get(res);
  jsonHooks.set(res, previous ? (body) => hook(previous(body)) : hook);
}
export function parsedBodyOf(req: IncomingMessage): unknown { return parsedBodies.get(req); }
export function json(res: ServerResponse, status: number, body: unknown) {
  const hook = jsonHooks.get(res);
  const data = JSON.stringify(hook ? hook(body) : body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}
export function readBody(req: IncomingMessage, limit = 1_000_000, timeoutMs = 30_000): Promise<any> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let bytes = 0;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (status: number, message: string) => {
      if (done) return;
      done = true;
      chunks = [];
      clearTimeout(timer);
      reject(Object.assign(new Error(message), { status }));
    };
    req.on("data", (chunk) => {
      if (done) return;
      const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      bytes += data.length;
      if (bytes > limit) return fail(413, "body too large");
      chunks.push(data);
    });
    req.once("end", () => {
      if (done) return;
      const data = Buffer.concat(chunks).toString("utf8");
      chunks = [];
      let body: any;
      try { body = data ? JSON.parse(data) : {}; }
      catch { return fail(400, "invalid JSON body"); }
      done = true;
      clearTimeout(timer);
      parsedBodies.set(req, body);
      resolve(body);
    });
    req.once("aborted", () => fail(400, "request body aborted"));
    req.once("error", () => fail(400, "request body interrupted"));
    if (req.aborted || req.destroyed) return fail(400, "request body aborted");
    const declared = req.headers?.["content-length"];
    if (declared !== undefined && (!/^\d+$/.test(String(declared)) || Number(declared) > limit)) return fail(413, "body too large");
    timer = setTimeout(() => fail(408, "request body timed out"), timeoutMs);
    timer.unref?.();
  });
}
