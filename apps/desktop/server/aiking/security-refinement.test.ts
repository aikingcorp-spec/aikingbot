// Copyright (c) 2026 AIKING.
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { WindowLimiter, createPublicAuthGuard, securityResponseHeaders } from "./request-guard.ts";
import { readBody, parsedBodyOf } from "../harness/http.ts";
import { createEmailSignIn } from "../account-signin.ts";
import { Lane, instanceSettings } from "../data/engine.ts";

const req = (ip = "203.0.113.1", origin?: string) => ({headers:{host:"app.example.test","x-forwarded-proto":"https",...(origin?{origin}:{})},socket:{remoteAddress:ip}} as unknown as IncomingMessage);
const bodyRequest = () => Object.assign(new PassThrough(), {headers:{}}) as unknown as IncomingMessage;

describe("public authentication abuse controls", () => {
  it("counts successful requests too and reopens after the window without throttling ordinary APIs", () => {
    let now=1000; const guard=createPublicAuthGuard(()=>now);
    for(let i=0;i<60;i++) expect(guard(req(),"/api/auth/email/start","POST")).toBeNull();
    expect(guard(req(),"/api/auth/email/verify","POST")).toMatchObject({status:429,retryAfter:60});
    expect(guard(req(),"/api/bots","GET")).toBeNull();
    expect(guard(req("203.0.113.2"),"/api/auth/pair","POST")).toBeNull();
    now+=60000;
    expect(guard(req(),"/api/auth/email/start","POST")).toBeNull();
  });
  it("does not evict active lockouts when new source keys fill the bounded map", () => {
    let now=0;const limiter=new WindowLimiter(1,1000,1,()=>now);
    expect(limiter.take("first")).toBe(0);expect(limiter.take("new")).toBe(1);expect(limiter.take("first")).toBe(1);
    now=1000;expect(limiter.take("new")).toBe(0);
  });
  it("rejects foreign browser origins while allowing same-origin browsers and native clients", () => {
    const guard=createPublicAuthGuard();
    expect(guard(req(undefined,"https://foreign.test"),"/api/auth/email/verify","POST")?.status).toBe(403);
    expect(guard(req(undefined,"https://app.example.test"),"/api/auth/email/verify","POST")).toBeNull();
    expect(guard(req(),"/api/pair","POST")).toBeNull();
  });
  it("limits OTP delivery for one normalized email even if callers rotate source addresses", async () => {
    let now=0;const send=vi.fn(async()=>({email:"user@example.test"}));
    const signin=createEmailSignIn({allow:{admins:[],members:[]},openIdentity:true,now:()=>now,client:{requestOTP:send} as never});
    for(let i=0;i<5;i++) expect(await signin.start("USER@example.test")).toEqual({ok:true});
    expect(await signin.start("user@example.test")).toMatchObject({status:429});
    expect(send).toHaveBeenCalledTimes(5);
    now+=600000;expect(await signin.start("user@example.test")).toEqual({ok:true});
  });
});
describe("request and response safety",()=>{
  it("fails an aborted JSON upload promptly",async()=>{
    const request=bodyRequest();const result=expect(readBody(request)).rejects.toMatchObject({status:400});
    request.emit("aborted");await result;
  });
  it("bounds time spent waiting for an unfinished upload",async()=>{
    vi.useFakeTimers();
    try {
      const result=expect(readBody(bodyRequest(),100,50)).rejects.toMatchObject({status:408});
      await vi.advanceTimersByTimeAsync(50);await result;
    } finally {vi.useRealTimers();}
  });
  it("rejects an oversized declared body without retaining its contents",async()=>{
    const request=bodyRequest();request.headers["content-length"]="1000";
    await expect(readBody(request,100)).rejects.toMatchObject({status:413});
    request.emit("data",Buffer.alloc(1000));request.emit("end");
  });
  it("still parses and remembers valid multilingual JSON",async()=>{
    const request=bodyRequest();const parsed=readBody(request);
    request.emit("data",Buffer.from('{"text":"Tiếng Việt 😀"}'));request.emit("end");
    expect(await parsed).toEqual({text:"Tiếng Việt 😀"});expect(parsedBodyOf(request)).toEqual({text:"Tiếng Việt 😀"});
  });
  it("prevents API caching and content sniffing",()=>{
    const headers=new Map<string,unknown>();
    securityResponseHeaders({setHeader:(k:string,v:unknown)=>headers.set(k,v)} as unknown as ServerResponse,"/api/bots");
    expect(Object.fromEntries(headers)).toMatchObject({"cache-control":"no-store","x-content-type-options":"nosniff","x-frame-options":"SAMEORIGIN","referrer-policy":"no-referrer"});
  });
});
it("bounds the database queue, releases slots after completion, and caps default spill space",async()=>{
  const lane=new Lane({interrupt:()=>{}} as never);
  let release!:()=>void;
  const first=lane.run("",{},()=>new Promise<void>(resolve=>{release=resolve;}));
  const rest=Array.from({length:31},()=>lane.run("",{},async()=>1));
  await expect(lane.run("",{},async()=>2)).rejects.toMatchObject({error:{code:"engine_unavailable",retryable:true}});
  release();await Promise.all([first,...rest]);
  expect(await lane.run("",{},async()=>3)).toBe(3);
  expect(instanceSettings("/bot","/data","v1",{}).max_temp_directory_size).toBe("512MB");
});
