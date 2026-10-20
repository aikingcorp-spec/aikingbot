// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright-core";
const [origin,storageState,out,baseline]=process.argv.slice(2);
assert.ok(origin&&storageState&&out&&baseline,"Usage: HTTPS_URL STORAGE_STATE OUTPUT BASELINE_ENVIRONMENT");
assert.equal(new URL(origin).protocol,"https:");
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.AIKING_CHROME||"/opt/google/chrome/chrome",headless:true});
const report={checks:[],rendererErrors:[]};
try{
 const anonymous=await browser.newContext();
 try{
  const environment=await(await anonymous.request.get(origin+"/.well-known/aikingbot/environment")).json();
  const before=JSON.parse(readFileSync(baseline,"utf8"));
  assert.equal(environment.environmentId,before.environmentId);
  assert.equal(environment.label,before.label);
  report.checks.push({name:"environment identity preserved",ok:true});
  for(const path of ["/api/bots","/api/config","/api/instances","/api/auth/sessions","/api/internal/agents"]){
   const response=await anonymous.request.get(origin+path);
   assert.ok([401,403].includes(response.status()),path);
   assert.equal(response.headers()["cache-control"],"no-store");
   assert.equal(response.headers()["x-content-type-options"],"nosniff");
  }
  report.checks.push({name:"anonymous sensitive APIs closed and not cached",ok:true});
  const rejected=await anonymous.request.post(origin+"/api/auth/email/start",{headers:{origin:"https://foreign.invalid"},data:{email:"do-not-send@example.invalid"}});
  assert.equal(rejected.status(),403);
  report.checks.push({name:"foreign-origin OTP rejected before delivery",ok:true});
  const manifest=await(await anonymous.request.get(origin+"/manifest.webmanifest")).json();
  assert.equal(manifest.name,"AIKINGBOT");
  report.checks.push({name:"AIKINGBOT manifest",ok:true});
 }finally{await anonymous.close();}
 for(const locale of ["en","vi"]){
  const context=await browser.newContext({storageState,viewport:{width:1440,height:950}});
  try{
   await context.addInitScript(language=>{localStorage.setItem("aiking-language",language);localStorage.setItem("aiking-advanced-mode","0");},locale);
   const page=await context.newPage();page.on("pageerror",error=>report.rendererErrors.push(error.message));
   await page.goto(origin);await page.locator("[data-workspace-rail]").waitFor({timeout:60000});
   await page.locator("[data-workspace-rail] button").nth(1).click();
   await page.locator("[data-workspace-panel]").waitFor();
   assert.equal(await page.locator("[data-workspace-create]").count(),0);
   assert.ok((await page.locator("[data-current-workspace]").innerText()).trim());
   await page.screenshot({path:join(out,"workspace-"+locale+".png")});
   await page.locator("[data-workspace-join]").click();
   await page.locator("[data-workspace-input]").fill("https://workspace.example.com/pair?code=NOT-ALLOWED");
   assert.equal(await page.locator("[data-workspace-panel] button[type=submit]").isEnabled(),false);
   await page.locator("[data-workspace-input]").fill("https://workspace.example.com/pair?email=member%40example.com");
   assert.equal(await page.locator("[data-workspace-panel] button[type=submit]").isEnabled(),true);
   await page.screenshot({path:join(out,"join-"+locale+".png")});
   await page.keyboard.press("Escape");
   await page.locator("[data-workspace-title]").click();
   await page.locator("[data-workspace-advanced]").click();
   await page.locator("[data-settings-search]").waitFor();
   assert.ok(await page.getByRole("dialog").count());
   await page.keyboard.press("Escape");
   await page.locator("[data-workspace-title]").click();
   const reconnect=locale==="en"?"Reconnect":"Kết nối lại";
   await page.getByRole("button",{name:reconnect,exact:true}).click();
   await page.locator("[data-workspace-rail]").waitFor();
   const session=await context.request.get(origin+"/api/auth/session");assert.equal(session.status(),200);
   report.checks.push({name:"workspace UI "+locale,ok:true,inviteValidation:true,advancedSettings:true,reconnectSession:true});
  }finally{await context.close();}
 }
 assert.deepEqual(report.rendererErrors,[]);
}finally{await browser.close();writeFileSync(join(out,"refinement-live.json"),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
