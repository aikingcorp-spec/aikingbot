// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { foundationRoot } from "./setup.mjs";

const [url, storageState, out] = process.argv.slice(2);
assert.ok(url && storageState && out, "Usage: URL STORAGE_STATE OUTPUT");
assert.equal(new URL(url).protocol, "https:");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.AIKING_CHROME || "/opt/google/chrome/chrome", headless: true });
const report = { checks: [], rendererErrors: [] };
try {
  for (const locale of ["en", "vi"]) {
    const labels = JSON.parse(readFileSync(join(foundationRoot, "overrides/src/locales", locale + ".json"), "utf8"));
    for (const advanced of [false, true]) {
      const ctx = await browser.newContext({ storageState, viewport: { width: 1440, height: 950 } });
      try {
        await ctx.addInitScript(({locale, advanced}) => {
          localStorage.setItem("aiking-language", locale);
          localStorage.setItem("aiking-advanced-mode", advanced ? "1" : "0");
          localStorage.setItem("aiking-email-gate", "skipped");
        }, {locale, advanced});
        const page = await ctx.newPage();
        page.on("pageerror", e => report.rendererErrors.push(e.message));
        await page.goto(url);
        await page.locator("[data-workspace-rail]").waitFor({timeout:60000});
        const trigger = page.locator("[data-account-dock] button[aria-haspopup=menu]").first();
        await trigger.click();
        await page.getByRole("menuitem", { name: labels["sidebar.menu.settings"], exact:true }).waitFor();
        for (const key of ["sidebar.menu.connectPhone", "sidebar.menu.getPhoneApp"]) {
          assert.equal(await page.getByRole("menuitem", {name:labels[key],exact:true}).count(),0);
        }
        assert.equal(await page.locator("[data-phone-status], [data-phone-app]").count(),0);
        await page.getByRole("menuitem", {name:labels["sidebar.menu.settings"],exact:true}).click();
        await page.locator("[data-settings-search]").waitFor();
        assert.equal(await page.locator('nav [data-settings-section="companion"]').count(),0);
        for (const term of ["phone","iPhone","Android"]) {
          await page.locator("[data-settings-search]").fill(term);
          assert.equal(await page.locator("[data-phone-pairing], [data-phone-app]").count(),0);
        }
        await page.screenshot({path:join(out,locale+"-"+(advanced?"advanced":"simple")+"-settings.png")});
        await page.locator("[data-settings-search]").fill("");
        await page.keyboard.press("Escape");
        await page.locator("[data-settings-search]").waitFor({state:"detached"});
        if (!advanced) {
          const pattern = labels["chat.openProfileAria"].split("{name}").map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join(".*");
          await page.getByRole("button",{name:new RegExp("^"+pattern+"$")}).first().click();
          await page.locator('[data-simple-row="identity"]').waitFor();
          for (const selector of ['[data-simple-row="phone"]','[data-simple-row="email"]','[data-simple-find="ios"]','[data-simple-find="android"]']) {
            assert.equal(await page.locator(selector).count(),0,selector);
          }
          await page.screenshot({path:join(out,locale+"-agent-profile.png")});
          await page.keyboard.press("Escape");
        }
        await page.evaluate(()=>localStorage.setItem("aikingbot.sidebarDensity","icons"));
        await page.reload();
        await page.locator("[data-workspace-rail]").waitFor();
        assert.equal(await page.locator("[data-phone-status]").count(),0);
        report.checks.push({locale,advanced,menu:true,settings:true,agentProfile:!advanced,iconSidebar:true});
      } finally {await ctx.close();}
    }
  }
  assert.deepEqual(report.rendererErrors,[]);
} finally {
  await browser.close();
  writeFileSync(join(out,"availability.json"),JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report));
