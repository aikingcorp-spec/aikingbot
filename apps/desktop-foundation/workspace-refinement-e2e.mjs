// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright-core";
import {runtimeRoot} from "./setup.mjs";
const info=JSON.parse(readFileSync(join(runtimeRoot,"offline-runtime.json"),"utf8"));
assert.equal(info.mode,"offline-verification");
assert.equal(new URL(info.apiUrl).hostname,"127.0.0.1");
const out=join(runtimeRoot,"evidence/security-refinement");
mkdirSync(out,{recursive:true});
async function api(path,body,token) {
 const response=await fetch(info.apiUrl+path,{method:body?"POST":"GET",headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,body:await response.json()};
}
async function person(label) {
 const code=(await api("/api/auth/pairing",{scopes:["client"]})).body.code;
 const result=await api("/api/auth/pair",{code,label});
 assert.equal(result.status,200);return result.body.token;
}
const bot=(await api("/api/bots",{name:"Workspace identities",modelSelection:{instanceId:"aiking-core-test",model:"aiking-offline"}})).body.bot;
const a=await person("Member A");const b=await person("Member B");
for(const [token,name]of[[a,"Member A"],[b,"Member B"]]){
 const result=await api("/api/bots/"+bot.id+"/messages",{text:"Hello from "+name,threadId:bot.threadId,sender:{name:"Forged owner",id:"forged"}},token);
 assert.ok(result.status>=200&&result.status<300,JSON.stringify(result));
 const deadline=Date.now()+30000;
 while((await api("/api/bots")).body.bots.find(value=>value.id===bot.id)?.busy){
  assert.ok(Date.now()<deadline,"Fixture turn did not finish");await new Promise(resolve=>setTimeout(resolve,100));
 }
}
const rows=(await api("/api/threads/"+bot.threadId+"/messages")).body.messages;
assert.ok(rows.some(row=>row.sender?.name==="Member A"));
assert.ok(rows.some(row=>row.sender?.name==="Member B"));
assert.ok(!rows.some(row=>row.sender?.name==="Forged owner"));
assert.equal((await api("/api/auth/pairing",{scopes:["admin"]},a)).status,403);
const browser=await chromium.launch({executablePath:process.env.AIKING_CHROME||"/opt/google/chrome/chrome",headless:true});
const report={senderBoundToSession:true,memberCannotMintAdmin:true,checks:[],rendererErrors:[]};
try{
 for(const locale of ["en","vi"]){
  const context=await browser.newContext({viewport:{width:1440,height:950}});
  try{
   await context.addInitScript(language=>{localStorage.setItem("aiking-language",language);localStorage.setItem("aiking-email-gate","skipped");},locale);
   const page=await context.newPage();page.on("pageerror",error=>report.rendererErrors.push(error.message));
   await page.goto(info.uiUrl);await page.locator("[data-workspace-rail]").waitFor();
   const skip=page.getByRole("button",{name:locale==="en"?"Skip tour":"Bỏ qua hướng dẫn",exact:true});
   if(await skip.isVisible().catch(()=>false))await skip.click();
   await page.locator('[data-sidebar-bot-row="'+bot.id+'"]').click();
   await page.locator("[data-message-sender]").filter({hasText:"Member A"}).first().waitFor();
   await page.locator("[data-message-sender]").filter({hasText:"Member B"}).first().waitFor();
   await page.locator("[data-server-add]").click();
   await page.locator("[data-workspace-panel]").waitFor();
   assert.equal(await page.locator("[data-workspace-create]").getAttribute("data-available"),"false");
   await page.screenshot({path:join(out,"workspace-"+locale+".png")});
   await page.locator("[data-workspace-join]").click();
   await page.locator("[data-workspace-input]").fill("https://join.example.test/pair?code=SECRET");
   assert.equal(await page.locator("[data-workspace-panel] button[type=submit]").isEnabled(),false);
   let forwardedCredentials=false;
   await page.route("https://join.example.test/**",async route=>{
    const headers=route.request().headers();forwardedCredentials=Boolean(headers.cookie||headers.authorization);
    await route.fulfill({contentType:"text/html",body:"<!doctype html><title>Isolated join destination</title>"});
   });
   await page.locator("[data-workspace-input]").fill("https://join.example.test/pair?email=member%40example.test");
   await page.locator("[data-workspace-panel] button[type=submit]").click();
   await page.waitForURL("https://join.example.test/pair?email=member%40example.test");
   assert.equal(forwardedCredentials,false);
   report.checks.push({locale,senderLabels:true,join:true,noLocalCreationOnWeb:true,queryCodeRefused:true,noCredentialForwarding:true});
  }finally{await context.close();}
 }
 assert.deepEqual(report.rendererErrors,[]);
}finally{await browser.close();writeFileSync(join(out,"workspace-e2e.json"),JSON.stringify(report,null,2));}
console.log("PASS workspace joins, session-bound sender labels and member privileges (isolated fixture)");
