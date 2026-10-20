// Copyright (c) 2026 AIKING.
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer,request as httpRequest} from "node:http";
import {randomUUID,createHmac} from "node:crypto";
import {Registry} from "./registry.mjs";
import {Platform} from "./server.mjs";
import {Provisioner} from "./worker.mjs";
import {grant,verifyGrant,digest,newToken} from "./common.mjs";
const owner={id:"owner-id",email:"owner@example.test"},member={id:"member-id",email:"member@example.test"};
async function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),"aiking-platform-test-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const db=new Registry(join(root,"registry.db"));t.after(()=>db.close());db.user(owner.id,owner.email);db.user(member.id,member.email);
 const id=randomUUID(),secret=newToken(),requests=[];
 const backend=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  requests.push({path:req.url,authorization:req.headers.authorization,cookie:req.headers.cookie,body:Buffer.concat(chunks).toString()});
  res.setHeader("content-type","application/json");
  if(req.url==="/api/platform/runtime-session") {
   const claims=verifyGrant(secret,JSON.parse(Buffer.concat(chunks)).grant);
   if(!claims||claims.aud!==id){res.writeHead(401);res.end("{}");return;}
   res.end(JSON.stringify({workspaceToken:"server-only-token-"+claims.role,session:{id:"backend-session",expiresAt:Date.now()+3600_000},accountCookie:"backend_account=private; Path=/"}));return;
  }
  if(req.url==="/api/config"){res.end(JSON.stringify({signIn:{admins:[owner.email],members:[]}}));return;}
  if(req.url==="/api/bots"){res.end(JSON.stringify({bots:[{id:"only-this-server"}]}));return;}
  res.end(JSON.stringify({ok:true}));
 });
 await new Promise(resolve=>backend.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise(resolve=>backend.close(resolve)));
 const base="http://127.0.0.1:"+backend.address().port;
 db.db.prepare("INSERT INTO servers VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,"Server A",owner.email,"ready",base,secret,0,Date.now(),"seed",null);
 db.db.prepare("INSERT INTO members VALUES(?,?,?)").run(id,owner.email,"owner");
 const staticDir=join(root,"dist");mkdirSync(staticDir);writeFileSync(join(staticDir,"index.html"),"<html><head></head><body>UI</body></html>");
 const calls=[],origin="https://platform.example.test";
 const platform=new Platform({database:join(root,"unused"),origin,staticDir,defaultServer:id,creationEmails:[owner.email],workerSocket:"fixture",
 bootstrapCookie:"aikingbot_account_test",authAPI:"http://127.0.0.1:1"},{
  registry:db,workerRPC:async(_socket,body)=>{calls.push(body);return{id:body.id,phase:"ready",baseURL:base};},
 });
 const server=createServer((req,res)=>void platform.handle(req,res));
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url="http://127.0.0.1:"+server.address().port;
 const issuedOwner=db.issue(owner),issuedMember=db.issue(member);
 const request=async(path,{body,token=issuedOwner.token,method=body?"POST":"GET",headers={}}={})=>{
  const response=await fetch(url+path,{method,headers:{"content-type":"application/json",origin,cookie:"__Host-aiking_platform="+token,...headers},...(body?{body:JSON.stringify(body)}:{})});
  return{status:response.status,headers:response.headers,body:await response.json().catch(()=>null)};
 };
 return{db,platform,id,secret,request,ownerToken:issuedOwner.token,memberToken:issuedMember.token,calls,requests,url,origin};
}
test("server grants are audience-bound, time-bound and reject modified signatures",()=>{
 const key=newToken(),value=grant(key,{aud:randomUUID(),email:owner.email});
 assert.equal(verifyGrant(key,value).email,owner.email);
 assert.equal(verifyGrant(newToken(),value),null);
 assert.equal(verifyGrant(key,value,Date.now()+60_000),null);
 assert.equal(verifyGrant(key,value+"bad"),null);
});
test("registry isolates membership and the public directory never leaks runtime secrets",async t=>{
 const f=await fixture(t);
 assert.equal(f.db.list(member).length,0);
 assert.equal(f.db.members(f.id).length,1);
 const result=await f.request("/api/platform/servers");assert.equal(result.status,200);
 assert.equal(result.body.servers.length,1);assert.equal(result.body.provider,"managed");
 assert.equal(JSON.stringify(result.body).includes(f.secret),false);
 assert.equal(JSON.stringify(result.body).includes("base_url"),false);
});
test("creation is idempotent, records the creator as owner and provisions only once",async t=>{
 const f=await fixture(t),key=randomUUID();
 const a=await f.request("/api/platform/servers",{body:{name:"B"},headers:{"idempotency-key":key}});
 assert.equal(a.status,202);await f.platform.processJobs();
 const b=await f.request("/api/platform/servers",{body:{name:"B"},headers:{"idempotency-key":key}});
 await f.platform.processJobs();assert.equal(a.body.server.id,b.body.server.id);
 assert.equal(f.calls.length,1);assert.equal(f.db.role(a.body.server.id,owner.email),"owner");
 assert.equal(f.db.server(a.body.server.id).status,"ready");
 assert.equal((await f.request("/api/platform/servers",{body:{name:"C"},headers:{"idempotency-key":key}})).status,409);
});
test("member cannot provision or access another server by changing its ID",async t=>{
 const f=await fixture(t);
 assert.equal((await f.request("/api/platform/servers",{token:f.memberToken,body:{name:"No"},headers:{"idempotency-key":randomUUID()}})).status,403);
 assert.equal((await f.request("/servers/"+f.id+"/api/bots",{token:f.memberToken})).status,403);
 assert.equal((await f.request("/api/platform/servers/"+f.id+"/members",{token:f.memberToken})).status,403);
});
test("proxy sends only the runtime credential and no global cookie",async t=>{
 const f=await fixture(t);
 assert.equal((await f.request("/servers/"+f.id+"/api/bots")).status,200);
 const forwarded=f.requests.find(x=>x.path==="/api/bots");
 assert.equal(forwarded.authorization,"Bearer server-only-token-owner");assert.equal(forwarded.cookie,undefined);
 assert.equal(JSON.stringify(f.requests).includes(f.ownerToken),false);
});
test("public access to runtime grant exchange is blocked at both path forms",async t=>{
 const f=await fixture(t);
 for(const path of ["/api/platform/runtime-session","/servers/"+f.id+"/api/platform/runtime-session"])
  assert.equal((await f.request(path,{body:{grant:"forged"}})).status,404);
});
test("membership changes synchronize backend before granting directory access and revoke it again",async t=>{
 const f=await fixture(t);
 const added=await f.request("/api/platform/servers/"+f.id+"/invites",{body:{email:member.email}});
 assert.equal(added.status,200);assert.ok(added.body.url.includes("/servers/"+f.id+"/pair?email="));
 assert.equal(f.db.role(f.id,member.email),"member");
 const memberDirectory=await f.request("/api/platform/servers",{token:f.memberToken});assert.equal(memberDirectory.body.servers.length,1);
 assert.equal((await f.request("/servers/"+f.id+"/api/bots",{token:f.memberToken})).status,200);
 assert.equal((await f.request("/api/platform/servers/"+f.id+"/members",{token:f.memberToken,method:"PUT",body:{admins:[owner.email],members:[]}})).status,403);
 assert.equal((await f.request("/api/platform/servers/"+f.id+"/members",{method:"PUT",body:{admins:[owner.email],members:[]}})).status,200);
 assert.equal((await f.request("/servers/"+f.id+"/api/bots",{token:f.memberToken})).status,403);
});
test("removing the original owner is rejected and cannot rewrite another server config",async t=>{
 const f=await fixture(t);
 assert.equal((await f.request("/api/platform/servers/"+f.id+"/members",{method:"PUT",body:{admins:[],members:[owner.email]}})).status,400);
 assert.equal(f.db.role(f.id,owner.email),"owner");
});
test("bootstrap trusts the one-time imported token hash and does not trust runtime account responses",async t=>{
 const f=await fixture(t),legacy="aka_"+newToken();
 f.db.db.prepare("INSERT INTO bootstrap VALUES(?,?,?,0)").run(digest(legacy),owner.id,Date.now()+600_000);
 const result=await f.request("/api/platform/session",{token:"",headers:{cookie:"aikingbot_account_test="+legacy}});
 assert.equal(result.body.authenticated,true);
 const set=result.headers.get("set-cookie");assert.ok(set.includes("HttpOnly"));assert.ok(set.includes("Secure"));
 const second=await f.request("/api/platform/session",{token:"",headers:{cookie:"aikingbot_account_test="+legacy}});
 assert.equal(second.body.authenticated,false);
});
test("global account shell lists invited servers even without access to default server",async t=>{
 const f=await fixture(t),id=randomUUID();
 f.db.db.prepare("INSERT INTO servers VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,"B",member.email,"ready","http://127.0.0.1:1",newToken(),0,Date.now()+1,"other",null);
 f.db.db.prepare("INSERT INTO members VALUES(?,?,?)").run(id,member.email,"owner");
 assert.equal((await f.request("/api/auth/session",{token:f.memberToken})).status,401);
 const account=await f.request("/api/account/session",{token:f.memberToken});
 assert.equal(account.status,200);assert.equal(account.body.workspaces[0].id,id);
 const entered=await f.request("/api/account/workspaces/"+id+"/enter",{token:f.memberToken,body:{label:"test"}});
 assert.equal(entered.body.url,"/servers/"+id+"/");
});
test("foreign origins, invalid parameters and traversal are rejected",async t=>{
 const f=await fixture(t);
 assert.equal((await f.request("/api/platform/servers",{headers:{origin:"https://foreign.test"}})).status,403);
 for(const body of [{name:"bad\nname"},{name:"x",image:"arbitrary"},{name:"x".repeat(61)}])
  assert.equal((await f.request("/api/platform/servers",{body,headers:{"idempotency-key":randomUUID()}})).status,400);
 const traversal=await fetch(f.url+"/%2e%2e%2fetc/passwd");
 assert.equal(traversal.status,404);
});
test("logout invalidates global authority and legacy cookies cannot bootstrap again",async t=>{
 const f=await fixture(t);
 assert.equal((await f.request("/api/platform/logout",{body:{}})).status,200);
 const directory=await f.request("/api/platform/servers");assert.equal(directory.status,401);
});
test("URL rewriting cannot corrupt chat text that starts with /api/",async t=>{
 const f=await fixture(t);
 const scoped=f.platform.rewriteJSON({text:"/api/this is user content",downloadUrl:"/api/files",publicUrl:f.origin},"/servers/"+f.id);
 assert.equal(scoped.text,"/api/this is user content");assert.equal(scoped.downloadUrl,"/servers/"+f.id+"/api/files");
 assert.equal(scoped.publicUrl,f.origin+"/servers/"+f.id);
});
test("worker refuses shell/mount/image injection and low-disk admission before allocating anything",async t=>{
 const root=mkdtempSync(join(tmpdir(),"aiking-provision-verify-"));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const worker=new Provisioner({root,testMode:true,maxServers:2,memoryBytes:1,reserveBytes:Number.MAX_SAFE_INTEGER,quotaBytes:1});
 await assert.rejects(worker.create({action:"create",id:"../../etc",name:"B",owner:owner.email,secret:newToken()}));
 await assert.rejects(worker.create({action:"create",id:randomUUID(),name:"B",owner:owner.email,secret:newToken(),image:"evil"}));
 await assert.rejects(worker.admission(),error=>error.code==="host_disk_low");
});

test("active server is selected only among the authenticated user's memberships",async t=>{
 const f=await fixture(t),b=randomUUID();
 f.db.db.prepare("INSERT INTO servers VALUES(?,?,?,?,?,?,?,?,?,?)").run(b,"B",owner.email,"ready",f.db.server(f.id).base_url,newToken(),0,Date.now(),"b-active",null);
 f.db.db.prepare("INSERT INTO members VALUES(?,?,?)").run(b,owner.email,"owner");
 assert.equal((await f.request("/api/platform/servers?active="+b)).body.activeId,b);
 assert.equal((await f.request("/api/platform/servers?active="+randomUUID())).body.activeId,f.id);
 assert.equal((await f.request("/api/platform/servers/"+f.id)).body.server.url,"/");
});
test("account routes receive only their private runtime cookie",async t=>{
 const f=await fixture(t);
 assert.equal((await f.request("/api/account/devices")).status,200);
 const forwarded=f.requests.find(x=>x.path==="/api/account/devices");
 assert.equal(forwarded.authorization,undefined);
 assert.equal(forwarded.cookie,"backend_account=private");
 assert.equal(forwarded.cookie.includes(f.ownerToken),false);
});
test("failed provisioning retries the original allocation identity",async t=>{
 const f=await fixture(t),key=randomUUID(),first=f.db.create(owner,"Retry B",key);
 f.db.failed(first.id,"temporary_failure");
 const retry=f.db.create(owner,"Retry B",key);
 assert.equal(retry.id,first.id);assert.equal(retry.status,"provisioning");assert.equal(retry.secret,first.secret);
});
test("only an owner can remove a failed Server that holds no data",async t=>{
 const f=await fixture(t),failed=f.db.create(owner,"Never allocated",randomUUID());f.db.failed(failed.id,"host_disk_low");
 const path="/api/platform/servers/"+failed.id;
 assert.equal((await f.request("/api/platform/servers/"+f.id,{method:"DELETE"})).status,409);
 f.db.db.prepare("INSERT INTO members VALUES(?,?,?)").run(failed.id,member.email,"member");
 assert.equal((await f.request(path,{method:"DELETE",token:f.memberToken})).status,403);
 f.platform.workerRPC=async()=>({phase:"failed",allocatedBytes:4096});
 assert.equal((await f.request(path,{method:"DELETE"})).body.error,"server_has_data");
 f.platform.workerRPC=async()=>{throw Object.assign(new Error("unknown_server"),{status:404});};
 assert.equal((await f.request(path,{method:"DELETE"})).status,200);
 assert.equal(f.db.server(failed.id),null);assert.equal(f.db.list(owner).some(s=>s.id===failed.id),false);
 assert.equal(f.db.server(f.id).status,"ready");
});
