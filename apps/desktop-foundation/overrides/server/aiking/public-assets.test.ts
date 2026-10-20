// Copyright (c) 2026 AIKING.
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,beforeEach,expect,it} from "vitest";
import {readPublicAsset} from "./public-assets.ts";
let fixture:string;let root:string;let outside:string;
beforeEach(()=>{
 fixture=mkdtempSync(join(tmpdir(),"aiking-static-boundary-"));root=join(fixture,"public");outside=join(fixture,"public-private");
 mkdirSync(join(root,"assets"),{recursive:true});mkdirSync(outside);
 writeFileSync(join(root,"index.html"),"<html>AIKINGBOT fixture</html>");
 writeFileSync(join(root,"assets","main.js"),"console.log('fixture')");
 writeFileSync(join(root,"assets","tiếng Việt.txt"),"Tiếng Việt");
 writeFileSync(join(outside,"secret.txt"),"private fixture marker");
});
afterEach(()=>rmSync(fixture,{recursive:true,force:true}));
it("serves bundled assets and unicode paths inside the public root",()=>{
 expect(readPublicAsset(root,"/index.html").toString()).toContain("AIKINGBOT fixture");
 expect(readPublicAsset(root,"/assets/main.js").toString()).toContain("fixture");
 expect(readPublicAsset(root,"/assets/"+encodeURIComponent("tiếng Việt.txt")).toString()).toBe("Tiếng Việt");
});
it("refuses traversal, backslash aliases, malformed escapes and control characters",()=>{
 for(const path of ["/../public-private/secret.txt","/%2e%2e/public-private/secret.txt","/assets/%2e%2e%2f%2e%2e/public-private/secret.txt","/assets\\..\\secret.txt","/%","/%00","relative.txt"]){
  expect(()=>readPublicAsset(root,path),path).toThrow();
 }
});
it("does not publish dotfiles or hidden directories",()=>{
 writeFileSync(join(root,".env"),"private fixture marker");mkdirSync(join(root,".git"));writeFileSync(join(root,".git","config"),"private fixture marker");
 for(const path of ["/.env","/%2eenv","/.git/config"])expect(()=>readPublicAsset(root,path)).toThrow();
});
it.skipIf(process.platform==="win32")("refuses both file and directory symlink escapes, including a sibling with the same prefix",()=>{
 symlinkSync(join(outside,"secret.txt"),join(root,"leak.txt"));
 symlinkSync(outside,join(root,"folder"),"dir");
 for(const path of ["/leak.txt","/folder/secret.txt"])expect(()=>readPublicAsset(root,path)).toThrow();
});
it.skipIf(process.platform==="win32")("allows an in-root asset link but never follows an escaped SPA index",()=>{
 symlinkSync(join(root,"assets","main.js"),join(root,"alias.js"));expect(readPublicAsset(root,"/alias.js").toString()).toContain("fixture");
 rmSync(join(root,"index.html"));symlinkSync(join(outside,"secret.txt"),join(root,"index.html"));
 expect(()=>readPublicAsset(root,"/index.html")).toThrow();
});
it("rejects directory reads and missing assets",()=>{
 for(const path of ["/assets","/missing.js"])expect(()=>readPublicAsset(root,path)).toThrow();
});
it.skipIf(process.platform!=="linux")("does not hang on a FIFO planted in the public directory",()=>{
 execFileSync("mkfifo",[join(root,"pipe")]);
 expect(()=>readPublicAsset(root,"/pipe")).toThrow();
});
