// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {chromium} from "playwright-core";
const [origin,out]=process.argv.slice(2);
assert.ok(origin&&out,"Usage: URL OUTPUT");assert.ok(["https:","http:"].includes(new URL(origin).protocol));
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.AIKING_CHROME||"/opt/google/chrome/chrome",headless:true});
const report={checks:[],rendererErrors:[],mutations:[]};
try{
 for(const locale of ["en","vi"]){
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  try{
   await context.addInitScript(language=>{if(location.protocol==="http:"||location.protocol==="https:")localStorage.setItem("aiking-language",language);},locale);
   const page=await context.newPage();
   page.on("pageerror",error=>report.rendererErrors.push(error.message));
   page.on("request",request=>{if(["POST","PUT","PATCH","DELETE"].includes(request.method()))report.mutations.push({method:request.method(),path:new URL(request.url()).pathname});});
   for(const code of ["%","%E0%A4%A"]){
    await page.goto("about:blank");
    await page.goto(origin+"/pair#code="+code);
    await page.locator("main form input").first().waitFor({timeout:60000});
    assert.equal(new URL(page.url()).hash,"");
    assert.equal(await page.locator("[data-workspace-rail]").count(),0);
   }
   report.checks.push({name:"malformed pairing "+locale,ok:true});
   await page.route("**/api/auth/session",route=>route.fulfill({status:200,contentType:"text/html",body:"<html>proxy fixture fallback</html>"}));
   await page.goto(origin+"/");
   await page.locator("main form input").first().waitFor({timeout:60000});
   assert.equal(await page.locator("[data-workspace-rail]").count(),0);
   await page.getByText(locale==="vi"?"Không thể xác minh đăng nhập. Hãy tải lại trang để thử lại.":"We couldn't verify your sign-in. Reload this page to try again.",{exact:true}).waitFor();
   await page.screenshot({path:join(out,"invalid-session-"+locale+".png")});
   report.checks.push({name:"invalid successful session response "+locale,ok:true,ownerUi:false});
  }finally{await context.close();}
 }
 assert.deepEqual(report.rendererErrors,[]);assert.deepEqual(report.mutations,[]);
}finally{await browser.close();writeFileSync(join(out,"session-boundary-live.json"),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
