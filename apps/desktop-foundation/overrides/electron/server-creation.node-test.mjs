// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import vm from "node:vm";
import { createRequire } from "node:module";
const require=createRequire(import.meta.url);
const {withLocalEnvironment}=require("./environments.cjs");
const serverManagement=require("./server-management.cjs");
test("basic local creation never reuses an unregistered data folder with the same name",t=>{
 const home=mkdtempSync(path.join(tmpdir(),"aiking-create-folder-"));
 t.after(()=>rmSync(home,{recursive:true,force:true}));
 const existing=path.join(home,".aikingbot-team");mkdirSync(existing);
 const marker=path.join(existing,"config.json");writeFileSync(marker,'{"fixture":"existing data"}');
 const main=readFileSync(new URL("./main.mjs",import.meta.url),"utf8");
 const start=main.indexOf("function createLocalEnvironment(name, dataDir) {");
 const end=main.indexOf("\nconst organizationEntry =",start);
 assert.ok(start>=0 && end>start);
 const context={app:{isPackaged:true},os:{homedir:()=>home},path,fs,randomUUID,
  environmentsState:{activeId:"local",environments:[]},withLocalEnvironment,
  desktopDataDir:()=>path.join(home,".aikingbot"),serverManagement};
 context.persistEnvironments=state=>{context.environmentsState=state;};
 vm.createContext(context);
 vm.runInContext(main.slice(start,end)+";this.createLocalEnvironment=createLocalEnvironment;",context);
 const result=context.createLocalEnvironment("Team");
 assert.equal(result.ok,true);
 const created=result.state.environments[0];
 assert.notEqual(created.dataDir,existing);
 assert.equal(readFileSync(marker,"utf8"),'{"fixture":"existing data"}');
 const again=context.createLocalEnvironment("Team");assert.equal(again.ok,true);
 assert.notEqual(again.state.environments[0].dataDir,again.state.environments[1].dataDir);
});
