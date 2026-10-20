// Copyright (c) 2026 AIKING.
import { createHmac,timingSafeEqual } from "node:crypto";
import type { IncomingMessage,ServerResponse } from "node:http";
import type { SessionRegistry,Scope } from "../sessions.ts";
import { z } from "zod";

const claimSchema=z.object({
  aud:z.string().uuid(),userId:z.string().min(1).max(256),email:z.string().email().max(254),
  role:z.enum(["owner","member"]),label:z.string().max(80),nonce:z.string().regex(/^[\w-]{43}$/),expiresAt:z.number(),
}).strict();
export function createPlatformRuntime(options:{
 key?:string;serverId?:string;sessions:Pick<SessionRegistry,"issue">;
 scopesFor:(email:string)=>readonly Scope[]|null;
 accountCookie:(identity:{userId:string;email:string},label:string,req:IncomingMessage)=>string|null;
}) {
  const consumed=new Map<string,number>();
  const enabled=Boolean(options.key&&options.serverId);
  return async function handle(req:IncomingMessage,res:ServerResponse,path:string,method:string):Promise<boolean> {
    if(path!=="/api/platform/runtime-session"||!enabled)return false;
    const reply=(status:number,body:unknown)=>{res.writeHead(status,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(body));return true;};
    if(method!=="POST"||!/^application\/json\b/i.test(String(req.headers["content-type"]||"")))return reply(400,{error:"invalid_runtime_grant"});
    let bytes=0;const chunks:Buffer[]=[];
    for await(const chunk of req){bytes+=chunk.length;if(bytes>8192)return reply(413,{error:"invalid_runtime_grant"});chunks.push(Buffer.from(chunk));}
    let input:unknown;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{return reply(400,{error:"invalid_runtime_grant"});}
    const token=Reflect.get(Object(input),"grant");
    if(typeof token!=="string"||token.length>4096)return reply(401,{error:"invalid_runtime_grant"});
    const [payload,signature,...extra]=token.split(".");
    if(!payload||!signature||extra.length)return reply(401,{error:"invalid_runtime_grant"});
    const expected=Buffer.from(createHmac("sha256",options.key!).update(payload).digest("base64url")),actual=Buffer.from(signature);
    if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return reply(401,{error:"invalid_runtime_grant"});
    let decoded:unknown;try{decoded=JSON.parse(Buffer.from(payload,"base64url").toString());}catch{return reply(401,{error:"invalid_runtime_grant"});}
    const parsed=claimSchema.safeParse(decoded);
    if(!parsed.success)return reply(401,{error:"invalid_runtime_grant"});
    const claim=parsed.data,now=Date.now();
    for(const [nonce,expires] of consumed)if(expires<=now)consumed.delete(nonce);
    if(claim.aud!==options.serverId||claim.expiresAt<=now||claim.expiresAt>now+31_000||consumed.has(claim.nonce)||consumed.size>=2000)return reply(401,{error:"invalid_runtime_grant"});
    const scopes=options.scopesFor(claim.email);
    if(!scopes||scopes.includes("admin")!==(claim.role==="owner"))return reply(403,{error:"membership_out_of_sync"});
    consumed.set(claim.nonce,claim.expiresAt);
    const issued=options.sessions.issue({label:claim.label||"AIKINGBOT platform",scopes:[...scopes],userId:claim.userId,email:claim.email});
    const accountCookie=options.accountCookie({userId:claim.userId,email:claim.email},claim.label,req);
    return reply(200,{workspaceToken:issued.token,session:issued.session,accountCookie});
  };
}
