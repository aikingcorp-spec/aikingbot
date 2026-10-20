// Copyright (c) 2026 AIKING.
import { afterEach,expect,it } from "vitest";
import { serverAPIPath } from "./server-scope.ts";
afterEach(()=>Reflect.deleteProperty(globalThis,"__aikingServerScope"));
it("preserves the existing transport outside platform-managed pages",()=>{
 expect(serverAPIPath("/api/bots")).toBe("/api/bots");
});
it("scopes API, streams, attachment and voice URLs and leaves global control requests unchanged",()=>{
 Reflect.set(globalThis,"__aikingServerScope",{prefix:"/servers/server-b",origin:"https://app.example.test",href:"https://app.example.test/servers/server-b/"});
 expect(serverAPIPath("/api/bots")).toBe("https://app.example.test/servers/server-b/api/bots");
 expect(serverAPIPath("/api/attachments/image.png")).toContain("/servers/server-b/api/attachments/");
 expect(serverAPIPath("/v1/voice/sessions")).toContain("/servers/server-b/v1/voice/");
 expect(serverAPIPath("/.well-known/aikingbot/environment")).toContain("/servers/server-b/.well-known/");
 expect(serverAPIPath("/api/platform/servers")).toBe("/api/platform/servers");
 expect(serverAPIPath("https://foreign.test/api/bots")).toBe("https://foreign.test/api/bots");
 expect(serverAPIPath("/servers/server-b/api/bots")).toBe("/servers/server-b/api/bots");
});
