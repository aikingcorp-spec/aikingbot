// Copyright (c) 2026 AIKING.
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { workspaceJoinURL } from "./workspace-link";
const {parseHostedWorkspaceLink} = createRequire(import.meta.url)("../../electron/environments.cjs");
it.each([
 ["workspace.example.com","https://workspace.example.com/pair"],
 ["https://workspace.example.com/pair?email=member%40example.com","https://workspace.example.com/pair?email=member%40example.com"],
 ["https://workspace.example.com/pair#code=ABCD-EFGH-JKLM","https://workspace.example.com/pair#code=ABCD-EFGH-JKLM"],
 ["http://127.0.0.1:4567","http://127.0.0.1:4567/pair"],
])("joins %s without losing an invitation or code",(input,expected)=>{
 expect(workspaceJoinURL(input)).toBe(expected);
 expect(parseHostedWorkspaceLink(input)?.url).toBe(input.includes("?email=") || input.includes("#code=") ? expected : new URL(expected).origin);
});
it.each([
 "http://workspace.example.com","javascript:alert(1)","https://name:password@workspace.example.com",
 "https://workspace.example.com/pair?code=ABCD-EFGH-JKLM",
 "https://workspace.example.com/pair?email=one@example.com&email=two@example.com",
 "https://workspace.example.com/pair?email=bad%0a@example.com",
 "https://workspace.example.com/pair?redirect=https://foreign.test",
 "https://workspace.example.com/not-the-app","https://workspace.example.com/#code=ABCD-EFGH-JKLM",
])("refuses unsafe or unsupported joins: %s",input=>{
 expect(workspaceJoinURL(input)).toBeNull();expect(parseHostedWorkspaceLink(input)).toBeNull();
});
