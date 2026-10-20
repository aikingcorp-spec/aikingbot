// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {sourceRoot,runtimeRoot} from "./setup.mjs";
const allowed={
 "electron/speech.mjs":"Existing macOS helper bundle path",
 "electron/build-speech-helper.mjs":"Existing macOS helper bundle path",
 "electron/desktop-server-auth.cjs":"Desktop owner capability header",
 "server/request-auth.ts":"Desktop owner capability header",
 "server/browser-engine-release.ts":"Pinned third-party binary URL",
 "server/local-computer.ts":"Existing installed browser discovery paths",
 "src/components/AboutDialog.tsx":"Apache attribution",
 "src/lib/app-links.ts":"Upstream license attribution",
 "server/phone-secret.ts":"HPKE v1 protocol bytes",
 "server/webhooks.ts":"Upstream issue reference",
};
const rows=[];
function scan(directory){
 for(const entry of readdirSync(join(sourceRoot,directory),{withFileTypes:true})){
  const path=directory+"/"+entry.name;
  if(entry.isDirectory()){if(!/^(node_modules|vendor|testing|fixtures?|__tests__)$/.test(entry.name))scan(path);continue;}
  if(!/\.(?:tsx?|mts|mjs|cjs|plist|css)$/.test(path)||/(?:\.test\.|\.node-test\.|\.spec\.)/.test(path))continue;
  const lines=readFileSync(join(sourceRoot,path),"utf8").split("\n");
  for(let i=0;i<lines.length;i++)if(/OpenMausBot|OpenMausMobile|MausBot/.test(lines[i]))rows.push({path,line:i+1,reason:allowed[path]??null});
 }
}
for(const directory of ["src","server","electron","shared"])scan(directory);
assert.deepEqual(rows.filter(row=>!row.reason),[],"Unclassified upstream product identity remains");
const pkg=JSON.parse(readFileSync(join(sourceRoot,"package.json"),"utf8"));
assert.equal(pkg.author.name,"AIKING");assert.equal(pkg.productName,"AIKINGBOT");
assert.equal(pkg.scripts["docs:dev"],undefined);
const plist=readFileSync(join(sourceRoot,"electron/resources/speech-helper-Info.plist"),"utf8");
assert.ok(plist.includes("AIKINGBOT listens")&&!plist.includes("OpenMausBot"));
const manifest=JSON.parse(readFileSync(join(sourceRoot,"public/manifest.webmanifest"),"utf8"));
assert.equal(manifest.name,"AIKINGBOT");
const out=join(runtimeRoot,"evidence/security-refinement");mkdirSync(out,{recursive:true});
writeFileSync(join(out,"identity-audit.json"),JSON.stringify({product:"AIKINGBOT",retainedCompatibilityAndAttribution:rows},null,2));
console.log("PASS product identity audit; retained compatibility/attribution references:",rows.length);
