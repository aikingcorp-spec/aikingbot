// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { runtimeRoot, sourceRoot } from "./setup.mjs";
import { launchVerificationServer } from "../../.aikingbot-foundation/source/scripts/control-aiking.ts";
const require=createRequire(import.meta.url);
const {createServerActions,serverDirectory}=require("../../.aikingbot-foundation/source/electron/server-management.cjs");
const {withLocalEnvironment,serializeEnvironments}=require("../../.aikingbot-foundation/source/electron/environments.cjs");
const out=join(runtimeRoot,"evidence/server-management");mkdirSync(out,{recursive:true});
const registryRoot=mkdtempSync(join(tmpdir(),"aiking-server-ux-registry-"));
const report={surface:"Chromium with fixture native bridge; actual isolated AIKINGBOT backends",nativeDialogs:"simulated approval; Electron/OS UI not qualified",checks:[],errors:[]};
const owned=[];let browser;let page;let active="local";let state={activeId:"local",environments:[]};
const launch=async()=>{const server=await launchVerificationServer({AIKING_CORE_TEST:"1"},undefined,undefined,undefined,undefined,undefined,[],undefined,join(sourceRoot,"dist"));owned.push(server);return server;};
const api=async(server,path,body,token)=>{
 const response=await fetch(server.info.url+path,{method:body?"POST":"GET",headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,body:await response.json()};
};
try {
 const a=await launch();let b;
 const destinations=new Map([["local",a]]);
 const save=()=>writeFileSync(join(registryRoot,"environments.json"),serializeEnvironments(state),{mode:0o600});
 save();
 browser=await chromium.launch({executablePath:process.env.AIKING_CHROME||"/opt/google/chrome/chrome",headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 page=await context.newPage();page.on("pageerror",error=>report.errors.push(error.message));
 const allowed=()=>new URL(page.url()).origin===destinations.get(active).info.url;
 const act=createServerActions({
  readState:()=>state,allowed,packaged:()=>true,companion:()=>false,confirm:async()=>true,
  create:async name=>{
   b=await launch();
   const result=withLocalEnvironment(state,{name,dataDir:b.info.dataDir},()=> "server-b",a.info.dataDir);
   assert.equal(result.ok,true);state=result.state;destinations.set("server-b",b);save();return{ok:true};
  },
  select:async id=>{
   assert.ok(destinations.has(id));active=id;state={...state,activeId:id};save();
   setTimeout(()=>void page.goto(destinations.get(id).info.url),10);
   return {ok:true};
  },connect:async()=>{throw new Error("not used");},
 });
 await context.exposeBinding("serverFixture",async(_source,action,input)=>{
  if(action==="directory")return serverDirectory(state,{packaged:true});
  return act({senderFrame:{url:page.url()}},action,input);
 });
 await context.addInitScript(()=>{
  localStorage.setItem("aiking-language","en");localStorage.setItem("aiking-email-gate","skipped");
  window.ogb={workspaces:{
   state:async()=>({name:location.origin,local:true}),menu:async()=>{},
   servers:()=>window.serverFixture("directory"),
   create:name=>window.serverFixture("create",name),
   select:id=>window.serverFixture("select",id),
   connect:link=>window.serverFixture("connect",link),
  }};
 });
 const ready=async()=>{
  await page.locator("[data-server-add]").waitFor({timeout:60000});
  const skip=page.getByRole("button",{name:"Skip tour",exact:true});
  if(await skip.isVisible().catch(()=>false))await skip.click();
 };
 await page.goto(a.info.url);await ready();
 const aAgent=(await api(a,"/api/bots",{name:"Only Server A",modelSelection:{instanceId:"aiking-core-test",model:"aiking-offline"}})).body.bot;
 await page.locator("[data-server-add]").click();await page.locator("[data-workspace-create]").click();
 await page.locator("[data-workspace-input]").fill("Server B");
 await page.locator("[data-server-panel] button[type=submit]").click();
 await page.waitForURL(url=>url.origin!==new URL(a.info.url).origin);
 await ready();assert.ok(b);
 assert.equal(await page.locator("[data-server-tile]").count(),2);
 assert.equal(await page.locator('[data-server-tile="server-b"]').getAttribute("aria-current"),"page");
 const bAgent=(await api(b,"/api/bots",{name:"Only Server B",modelSelection:{instanceId:"aiking-core-test",model:"aiking-offline"}})).body.bot;
 assert.ok(aAgent.id!==bAgent.id);
 assert.equal((await api(b,"/api/bots")).body.bots.some(x=>x.id===aAgent.id),false);
 assert.equal((await api(a,"/api/bots")).body.bots.some(x=>x.id===bAgent.id),false);
 const send=await api(b,"/api/bots/"+bAgent.id+"/messages",{text:"Server B history marker",threadId:bAgent.threadId});
 assert.ok(send.status>=200&&send.status<300);
 for(let i=0;i<100;i++){if(!(await api(b,"/api/bots")).body.bots.find(x=>x.id===bAgent.id)?.busy)break;await new Promise(r=>setTimeout(r,100));}
 const rows=(await api(b,"/api/threads/"+bAgent.threadId+"/messages")).body.messages;
 assert.ok(rows.some(x=>x.text==="Server B history marker"));
 const cross=await api(a,"/api/threads/"+bAgent.threadId+"/messages");
 assert.ok(cross.status===404 || !JSON.stringify(cross.body).includes("Server B history marker"));
 await page.screenshot({path:join(out,"desktop-bridge-two-servers.png")});
 await page.locator('[data-server-tile="local"]').click();await page.waitForURL(a.info.url+"/");await ready();
 assert.equal(await page.locator("[data-server-tile]").count(),2);
 assert.equal((await api(a,"/api/bots")).body.bots.some(x=>x.id===aAgent.id),true);
 await page.locator('[data-server-tile="server-b"]').click();await page.waitForURL(b.info.url+"/");await ready();
 await page.reload();await ready();assert.equal(await page.locator("[data-server-tile]").count(),2);
 assert.ok((await api(b,"/api/threads/"+bAgent.threadId+"/messages")).body.messages.some(x=>x.text==="Server B history marker"));
 report.checks.push({name:"Create B through actual panel and controller, two real servers",ok:true});
 report.checks.push({name:"Agent/history isolation, A/B switch, reload and saved directory",ok:true});
 const pairing=(await api(b,"/api/auth/pairing",{scopes:["client"]})).body;
 const paired=await api(b,"/api/auth/pair",{code:pairing.code,label:"Member B"});
 assert.equal(paired.status,200);const token=paired.body.token;
 assert.equal((await api(b,"/api/auth/pairing",{scopes:["admin"]},token)).status,403);
 assert.equal((await api(a,"/api/bots",undefined,token)).status,401);
 report.checks.push({name:"B member cannot mint owner access or authenticate on A",ok:true});
 assert.deepEqual(report.errors,[]);
 report.ok=true;
} catch(error){report.ok=false;report.failure=error.stack;throw error;}
finally {
 await browser?.close();
 for(const server of owned.reverse())await server.close();
 report.cleaned=owned.every(server=>!existsSync(server.info.dataDir));
 rmSync(registryRoot,{recursive:true,force:true});
 writeFileSync(join(out,"two-server-e2e.json"),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}
