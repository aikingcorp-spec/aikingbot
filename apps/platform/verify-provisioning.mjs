// Copyright (c) 2026 AIKING.
// Real Docker + bounded ext4 volumes; authentication and model replies use owned fixtures only.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createServer as httpServer} from "node:http";
import {createServer as httpsServer} from "node:https";
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,statfsSync} from "node:fs";
import {join,resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {Registry} from "./registry.mjs";
import {Platform} from "./server.mjs";
import {Provisioner} from "./worker.mjs";
import {GiB,newToken} from "./common.mjs";
const require=createRequire(new URL("../desktop-foundation/package.json",import.meta.url));
const {chromium}=require("playwright-core");
const repo=resolve(new URL("../..",import.meta.url).pathname);
const evidence=join(repo,".aikingbot-foundation/evidence/server-provisioning");
mkdirSync(evidence,{recursive:true});
const base="/srv/aikingbot-staging/platform-verification";mkdirSync(base,{recursive:true,mode:0o700});
const root=mkdtempSync(join(base,"run-")),volumes=join(root,"volumes");mkdirSync(volumes);
const report={surface:"Real isolated Docker runtimes, HTTPS gateway and Chromium; fixture OTP and model; no real mail or paid provider",checks:[],errors:[],ownedIds:[],cleaned:false};
const owner={id:"fixture-owner-id",email:"owner@fixture.test"},member={id:"fixture-member-id",email:"member@fixture.test"};
let browser,worker,registry,platform,front,auth;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pass=name=>{report.checks.push({name,ok:true});console.log("PASS "+name);};
const run=(bin,args)=>execFileSync(bin,args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
async function checkApi(context,origin,path,{body,method=body?"POST":"GET",headers={}}={}) {
 const r=await context.request.fetch(origin+path,{method,headers:{origin,"content-type":"application/json",...headers},...(body?{data:body}:{}),timeout:30000});
 return{status:r.status(),body:await r.json().catch(()=>null)};
}
try {
 run("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",join(root,"tls.key"),"-out",join(root,"tls.crt"),"-days","1","-subj","/CN=localhost","-addext","subjectAltName=DNS:localhost,IP:127.0.0.1"]);
 front=httpsServer({key:readFileSync(join(root,"tls.key")),cert:readFileSync(join(root,"tls.crt"))},(req,res)=>void platform.handle(req,res));
 front.on("upgrade",(req,socket,head)=>void platform.upgrade(req,socket,head));
 await new Promise(r=>front.listen(0,"127.0.0.1",r));const origin="https://127.0.0.1:"+front.address().port;
 const challenges=new Map();
 auth=httpServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks)||"{}");res.setHeader("content-type","application/json");
  if(req.url.endsWith("/start")){const challengeId=randomUUID();challenges.set(challengeId,body.email);res.end(JSON.stringify({challengeId,expiresAt:Date.now()+600000}));return;}
  const address=challenges.get(body.challengeId);
  if(body.code!=="ABCD-EFGH"||address!==member.email){res.writeHead(401);res.end("{}");return;}
  res.end(JSON.stringify({user:member,sessionToken:"fixture-upstream-not-persisted"}));
 });await new Promise(r=>auth.listen(0,"127.0.0.1",r));
 const image=process.env.AIKING_TEST_IMAGE||"aikingbot-provisioning-fixture:c5edbfc";
 worker=new Provisioner({root:volumes,testMode:true,fixtureCli:"/opt/aiking-fixture/fake-claude-cli.ts",maxServers:2,
  memoryBytes:GiB,quotaBytes:512*1024*1024,reserveBytes:10*GiB,portBase:28910,image,
  imageId:run("docker",["image","inspect","--format","{{.Id}}",image]),edgeImage:"caddy:2.10.2",origin,authAPI:"http://127.0.0.1:"+auth.address().port});
 registry=new Registry(join(root,"manager.db"));registry.user(owner.id,owner.email);
 const aId=randomUUID(),aKey=newToken();report.ownedIds.push(aId);
 const a=await worker.create({action:"create",id:aId,name:"Fixture Server A",owner:owner.email,secret:aKey});
 assert.equal(a.phase,"ready");
 registry.db.prepare("INSERT INTO servers VALUES(?,?,?,?,?,?,?,?,?,?)").run(aId,"Fixture Server A",owner.email,"ready",a.baseURL,aKey,0,Date.now(),"fixture-a",null);
 registry.db.prepare("INSERT INTO members VALUES(?,?,?)").run(aId,owner.email,"owner");
 platform=new Platform({origin,authAPI:"http://127.0.0.1:"+auth.address().port,defaultServer:aId,creationEmails:[owner.email],
  staticDir:process.env.AIKING_TEST_STATIC_DIR||join(repo,".aikingbot-foundation/source/dist"),workerSocket:"fixture"},{registry,
  workerRPC:async(_sock,body)=>{if(body.action==="create"){if(!report.ownedIds.includes(body.id))report.ownedIds.push(body.id);return worker.create(body);}return worker.status(body.id);}});
 const issued=registry.issue(owner);
 browser=await chromium.launch({executablePath:"/opt/google/chrome/chrome",headless:true,args:["--no-sandbox"]});
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
 await context.addCookies([{name:"__Host-aiking_platform",value:issued.token,url:origin,secure:true,httpOnly:true,sameSite:"Lax"}]);
 await context.addInitScript(()=>{localStorage.setItem("aiking-language","en");localStorage.setItem("aiking-email-gate","skipped");});
 context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
 const page=await context.newPage();page.on("pageerror",e=>report.errors.push(e.message));
 const api=(p,o)=>checkApi(context,origin,p,o);
 const ready=async()=>{await page.locator("[data-server-add]").waitFor({timeout:60000});const skip=page.getByRole("button",{name:"Skip tour",exact:true});if(await skip.isVisible().catch(()=>false))await skip.click();};
 await page.goto(origin);await ready();
 assert.equal((await api("/api/auth/session")).status,200);
 const aAgent=(await api("/api/bots",{body:{name:"Only A",modelSelection:{instanceId:"fixture",model:"claude-sonnet-5"}}})).body.bot;
 assert.ok(aAgent?.threadId);
 await page.locator("[data-server-add]").click();await page.locator("[data-workspace-create]").click();
 await page.locator("[data-workspace-input]").fill("Fixture Server B");
 await page.locator("[data-server-panel] button[type=submit]").click();
 await page.waitForURL(url=>url.pathname.startsWith("/servers/"),{timeout:150000});await ready();
 const bId=/\/servers\/([^/]+)/.exec(page.url())[1],prefix="/servers/"+bId;
 assert.notEqual(aId,bId);assert.equal(await page.locator("[data-server-tile]").count(),2);
 const b=registry.server(bId);assert.equal(b.status,"ready");assert.notEqual(b.secret,aKey);
 const bAgent=(await api(prefix+"/api/bots",{body:{name:"Only B",modelSelection:{instanceId:"fixture",model:"claude-sonnet-5"}}})).body.bot;assert.ok(bAgent?.threadId);
 pass("Name-only Web UI provisions real B and displays two Server tiles");
 assert.equal((await api(prefix+"/api/bots")).body.bots.some(x=>x.id===aAgent.id),false);
 assert.equal((await api("/api/bots")).body.bots.some(x=>x.id===bAgent.id),false);
 assert.equal(readFileSync(join(volumes,bId,"data/.aikingbot/environment-id"),"utf8").trim(),bId);
 const send=await api(prefix+"/api/bots/"+bAgent.id+"/messages",{body:{text:"B isolated history marker",threadId:bAgent.threadId}});
 assert.equal(send.status,202);
 for(let i=0;i<120;i++){if(!(await api(prefix+"/api/bots")).body.bots.find(x=>x.id===bAgent.id)?.busy)break;await sleep(250);}
 let history=(await api(prefix+"/api/threads/"+bAgent.threadId+"/messages")).body.messages;
 assert.ok(history.some(x=>x.text==="B isolated history marker"));
 report.historyDebug=history.map(x=>({role:x.role,kind:x.kind,text:x.text}));
 assert.ok(history.some(x=>x.role==="bot"&&x.text?.includes("Verification reply")));
 const cross=await api("/api/threads/"+bAgent.threadId+"/messages");assert.ok(cross.status===404||!JSON.stringify(cross.body).includes("B isolated history marker"));
 pass("Separate runtime identity, agents, credentials and successful isolated chat histories");
 await page.screenshot({path:join(evidence,"web-two-real-docker-servers.png")});
 await page.locator('[data-server-tile="'+aId+'"]').click();await page.waitForURL(origin+"/");await ready();
 assert.ok((await api("/api/bots")).body.bots.some(x=>x.id===aAgent.id));
 await page.locator('[data-server-tile="'+bId+'"]').click();await page.waitForURL(origin+prefix+"/");await ready();await page.reload();await ready();
 assert.equal(await page.locator("[data-server-tile]").count(),2);
 pass("A/B switching and page reload preserve the correct Server context");
 const invite=await api("/api/platform/servers/"+bId+"/invites",{body:{email:member.email}});assert.equal(invite.status,200);
 const memberContext=await browser.newContext({ignoreHTTPSErrors:true});
 const memberApi=(p,o)=>checkApi(memberContext,origin,p,o);
 const memberPage=await memberContext.newPage();
 await memberPage.goto(invite.body.url);await memberPage.locator("#signin-email").waitFor();
 assert.equal(await memberPage.locator("#signin-email").inputValue(),member.email);
 await memberPage.locator("form button[type=submit]").click();await memberPage.locator("#signin-code").fill("ABCD-EFGH");
 await memberPage.locator("form button[type=submit]").click();await memberPage.waitForURL(origin+prefix+"/",{timeout:30000});
 await memberPage.locator("[data-server-add]").waitFor();
 assert.equal(await memberPage.locator("[data-server-tile]").count(),1);
 await memberPage.screenshot({path:join(evidence,"invited-member-only-b.png")});
 const memberDirectory=await memberApi("/api/platform/servers");assert.deepEqual(memberDirectory.body.servers.map(x=>x.id),[bId]);
 assert.equal((await memberApi("/servers/"+aId+"/api/bots")).status,403);
 assert.equal((await memberApi(prefix+"/api/auth/pairing",{body:{scopes:["admin"]}})).status,403);
 assert.equal((await memberApi("/api/platform/servers",{body:{name:"Unauthorized"},headers:{"idempotency-key":randomUUID()}})).status,403);
 const memberSend=await memberApi(prefix+"/api/bots/"+bAgent.id+"/messages",{body:{text:"Member-authored B marker",threadId:bAgent.threadId,sender:{userId:owner.id,email:owner.email}}});assert.equal(memberSend.status,202);
 for(let i=0;i<120;i++){if(!(await api(prefix+"/api/bots")).body.bots.find(x=>x.id===bAgent.id)?.busy)break;await sleep(250);}
 history=(await api(prefix+"/api/threads/"+bAgent.threadId+"/messages")).body.messages;
 const authored=history.find(x=>x.text==="Member-authored B marker");assert.ok(authored);
 report.sender=authored.sender;
 assert.equal(authored.sender?.name,member.email);assert.ok(authored.sender?.id);
 const members=await api("/api/platform/servers/"+bId+"/members");assert.equal(members.body.members.find(x=>x.email===member.email).userId,member.id);
 assert.equal((await api("/api/platform/servers/"+bId+"/members",{method:"PUT",body:{admins:[owner.email],members:[]}})).status,200);
 assert.equal((await memberApi(prefix+"/api/bots")).status,403);
 pass("Invite, OTP identity, Member restrictions, stable sender User ID and revocation");
 run("docker",["restart",worker.names(bId).app]);
 for(let i=0;i<90;i++){try{if((await worker.status(bId)).phase==="ready")break;}catch{}await sleep(500);}
 assert.ok((await api(prefix+"/api/threads/"+bAgent.threadId+"/messages")).body.messages.some(x=>x.text==="B isolated history marker"));
 pass("Container restart reconnects and preserves B data");
 const quotaFile=join(volumes,bId,"data/quota-test.bin");let denied=false;
 try{run("fallocate",["-l",String(768*1024*1024),quotaFile]);}catch{denied=true;}finally{rmSync(quotaFile,{force:true});}
 assert.equal(denied,true);assert.ok(statfsSync(join(volumes,bId,"data")).blocks*4096<=512*1024*1024);
 assert.equal((await api(prefix+"/api/bots")).status,200);
 await assert.rejects(worker.admission(),e=>e.code==="host_server_limit");
 pass("Filesystem hard quota rejects excess writes; runtime survives; host allocation cap enforced");
 assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;report.operation=error.operation;report.detail=error.detail;process.exitCode=1;}
finally{
 await browser?.close();
 if(platform)for(const c of platform.active)c.close();
 if(worker){for(let i=0;worker.busy&&i<240;i++)await sleep(500);for(const id of report.ownedIds.reverse())await worker.cleanupTest(id).catch(e=>report.errors.push("cleanup:"+id+":"+(e.code||e.message)));}
 if(front){front.closeAllConnections();await new Promise(r=>front.close(r));}
 if(auth){auth.closeAllConnections();await new Promise(r=>auth.close(r));}
 registry?.close();report.cleaned=report.ownedIds.every(id=>!existsSync(join(volumes,id)));
 if(report.cleaned)rmSync(root,{recursive:true,force:true});
 writeFileSync(join(evidence,"real-docker-e2e.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
