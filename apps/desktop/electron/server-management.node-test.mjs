// Copyright (c) 2026 AIKING.
import assert from "node:assert/strict";
import { test } from "node:test";
import management from "./server-management.cjs";
const state = () => ({ activeId:"vps", environments:[
 {id:"vps",name:"Team A",origin:"https://a.example.test",microphone:true},
 {id:"b",kind:"local",name:"Team B",dataDir:"/private/team-b"},
 {id:"gone",kind:"local",name:"Gone",dataDir:"/private/gone",missing:true},
]});
function fixture(extra={}) {
 let value=state(); const calls=[];
 const dependencies={
  readState:()=>value,allowed:()=>true,packaged:()=>true,companion:()=>false,
  confirm:async(...args)=>{calls.push(["confirm",...args.slice(1)]);return true;},
  create:name=>{value.environments.push({id:"c",kind:"local",name,dataDir:"/private/c"});return {ok:true};},
  select:async id=>{calls.push(["select",id]);value.activeId=id;return {ok:true};},
  connect:async url=>{calls.push(["connect",url]);return true;},...extra,
 };
 return {run:management.createServerActions(dependencies),calls,dependencies,read:()=>value};
}
test("directory discloses names and opaque IDs without paths, origins, credentials or grants",()=>{
 const directory=management.serverDirectory(state(),{packaged:true});
 assert.deepEqual(directory.servers.map(x=>x.id),["local","vps","b","gone"]);
 assert.equal(directory.activeId,"vps");assert.equal(directory.canCreate,true);
 for(const key of ["origin","dataDir","microphone"])assert.equal(JSON.stringify(directory).includes(key),false);
 assert.deepEqual(management.serverDirectory(state(),{packaged:true,companion:true}).servers,[]);
});
test("creates a local server then opens precisely its new ID",async()=>{
 const f=fixture();assert.deepEqual(await f.run({},"create"," Team C "),{ok:true});
 assert.equal(f.read().environments.find(x=>x.id==="c").name,"Team C");
 assert.deepEqual(f.calls.at(-1),["select","c"]);
});
test("cancel leaves environment registry and running server unchanged",async()=>{
 const f=fixture({confirm:async()=>false});
 assert.deepEqual(await f.run({},"create","C"),{ok:false,error:"cancelled"});
 assert.equal(f.read().environments.length,3);assert.equal(f.read().activeId,"vps");
});
test("refuses subframes, unknown/missing IDs, untrusted actions and nonpackaged creation",async()=>{
 for(const extra of [{allowed:()=>false},{companion:()=>true}])await assert.rejects(fixture(extra).run({},"select","local"));
 for(const id of ["unknown","gone","/private/path",{},null])await assert.rejects(fixture().run({},"select",id));
 for(const name of ["","  ","x".repeat(61),"bad\u0000name",{}])await assert.rejects(fixture().run({},"create",name));
 await assert.rejects(fixture({packaged:()=>false}).run({},"create","C"));
 await assert.rejects(fixture().run({},"purge","b"));
});
test("dialog cannot approve work after its original renderer loses authority",async()=>{
 let allowed=true;const f=fixture({allowed:()=>allowed,confirm:async()=>{allowed=false;return true;}});
 await assert.rejects(f.run({},"create","C"),/active server changed/);
 assert.equal(f.read().environments.length,3);
});
test("double submission cannot create duplicate servers",async()=>{
 let finish;const f=fixture({confirm:()=>new Promise(resolve=>{finish=resolve;})});
 const first=f.run({},"create","C");
 assert.deepEqual(await f.run({},"create","D"),{ok:false,error:"busy"});
 finish(true);await first;assert.equal(f.read().environments.length,4);
});
test("pairing keeps fragment credential in the existing native connection flow",async()=>{
 const f=fixture();const event={};
 assert.deepEqual(await f.run(event,"connect","https://a.example.test/pair#code=ABCDEFGHIJKL"),{ok:true});
 assert.deepEqual(f.calls.at(-1),["connect","https://a.example.test/pair#code=ABCDEFGHIJKL"]);
 for(const url of ["https://a.example.test/pair?code=SECRET","file:///etc/passwd","http://a.example.test","https://a.example.test/evil","https://user:pass@a.example.test"])await assert.rejects(f.run({},"connect",url));
});
test("failed creation does not open another server",async()=>{
 const f=fixture({create:()=>({ok:false,error:"path"})});
 assert.deepEqual(await f.run({},"create","C"),{ok:false,error:"path"});
 assert.equal(f.calls.some(x=>x[0]==="select"),false);
});
test("switch failure is surfaced to the UX",async()=>{
 assert.deepEqual(await fixture({select:async()=>({ok:false,error:"busy"})}).run({},"select","b"),{ok:false,error:"busy"});
});

test("changing active ID during confirmation invalidates the old request even if origin checks still pass",async()=>{
 const f=fixture();
 f.dependencies.confirm=async()=>true;
 const g=fixture({confirm:async()=>{g.read().activeId="b";return true;}});
 await assert.rejects(g.run({},"create","C"),/active server changed/);
 assert.equal(g.read().environments.length,3);
});
