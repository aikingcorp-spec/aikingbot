// Copyright (c) 2026 AIKING.
import { createHmac,randomBytes,randomUUID } from "node:crypto";
import { createServer,type Server } from "node:http";
import { afterEach,expect,it,vi } from "vitest";
import { createPlatformRuntime } from "./platform-runtime.ts";
const servers:Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>(done=>server.close(()=>done()))));});
function signed(key:string,claims:Record<string,unknown>) {
 const data=Buffer.from(JSON.stringify(claims)).toString("base64url");
 return data+"."+createHmac("sha256",key).update(data).digest("base64url");
}
async function fixture() {
 const key=randomBytes(32).toString("base64url"),id=randomUUID();
 const issue=vi.fn(()=>({token:"private-runtime-token",session:{id:"session",label:"label",scopes:["admin" as const,"client" as const],createdAt:Date.now(),lastSeenAt:Date.now(),expiresAt:Date.now()+10000}}));
 const handle=createPlatformRuntime({key,serverId:id,sessions:{issue},scopesFor:address=>address==="owner@example.test"?["admin","client"]:address==="member@example.test"?["client"]:null,accountCookie:()=> "private-account-cookie"});
 const server=createServer(async(req,res)=>{if(!await handle(req,res,new URL(req.url!,"http://local").pathname,req.method!)){res.writeHead(404);res.end();}});
 servers.push(server);await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));
 const port=(server.address() as {port:number}).port;
 const claim={aud:id,userId:"user-123",email:"owner@example.test",role:"owner",label:"My account",nonce:randomBytes(32).toString("base64url"),expiresAt:Date.now()+30000};
 const post=(value:string)=>fetch("http://127.0.0.1:"+port+"/api/platform/runtime-session",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({grant:value})});
 return{key,id,claim,post,issue};
}
it("issues the existing session type for the verified server-bound account and consumes its nonce",async()=>{
 const f=await fixture(),value=signed(f.key,f.claim);
 const response=await f.post(value);expect(response.status).toBe(200);
 expect(((await response.json()) as {workspaceToken:string}).workspaceToken).toBe("private-runtime-token");
 expect(f.issue).toHaveBeenCalledWith({label:"My account",scopes:["admin","client"],userId:"user-123",email:"owner@example.test"});
 expect((await f.post(value)).status).toBe(401);expect(f.issue).toHaveBeenCalledTimes(1);
});
it("rejects wrong audience, key, expiry, unknown fields and malformed values",async()=>{
 const f=await fixture();
 for(const change of [{aud:randomUUID()},{expiresAt:Date.now()-1},{expiresAt:Date.now()+60000},{extra:true}])
  expect((await f.post(signed(f.key,{...f.claim,...change}))).status).toBe(401);
 expect((await f.post(signed("wrong-key",f.claim))).status).toBe(401);
 expect((await f.post("invalid")).status).toBe(401);
 expect(f.issue).not.toHaveBeenCalled();
});
it("cannot elevate a member or create access outside the runtime membership list",async()=>{
 const f=await fixture();
 expect((await f.post(signed(f.key,{...f.claim,email:"member@example.test"}))).status).toBe(403);
 expect((await f.post(signed(f.key,{...f.claim,email:"outsider@example.test"}))).status).toBe(403);
 expect((await f.post(signed(f.key,{...f.claim,email:"member@example.test",role:"member"}))).status).toBe(200);
 expect(f.issue).toHaveBeenCalledTimes(1);
});
