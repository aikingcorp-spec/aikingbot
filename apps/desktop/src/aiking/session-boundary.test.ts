// Copyright (c) 2026 AIKING.
import {afterEach,expect,it,vi} from "vitest";
import {isConnected,isOwnerOrAdmin,readSessionState,takePairingCodeFromLocation} from "@/lib/session";
import {setLocale} from "@/lib/i18n";
const response=(body:unknown)=>(async()=>new Response(JSON.stringify(body),{status:200})) as typeof fetch;
afterEach(()=>{vi.unstubAllGlobals();setLocale("en");});
it("does not invent a local owner from a malformed or unrelated successful response",async()=>{
 for(const body of [null,{},[],{error:"proxy fallback"},{kind:"session"},{kind:"session",id:""},{kind:"loopback",trust:"unrecognized"}]){
  const state=await readSessionState(response(body));
  expect(state.kind).toBe("unreachable");
  expect(isOwnerOrAdmin(state)).toBe(false);
  expect(isConnected(state)).toBe(false);
 }
 const html=await readSessionState((async()=>new Response("<html>proxy</html>",{status:200})) as typeof fetch);
 expect(html.kind).toBe("unreachable");
 expect(isOwnerOrAdmin(html)).toBe(false);
 setLocale("vi");const vietnamese=await readSessionState(response({}));
 expect(vietnamese.kind==="unreachable"&&vietnamese.error).toContain("đăng nhập");
});
it("only accepts explicit loopback and well-formed session descriptors",async()=>{
 expect(await readSessionState(response({kind:"loopback"}))).toEqual({kind:"loopback"});
 expect(await readSessionState(response({kind:"loopback",trust:"service"}))).toEqual({kind:"loopback",trust:"service"});
 for(const body of [
  {kind:"session",id:"s",scopes:"admin",expiresAt:1},
  {kind:"session",id:"s",scopes:["admin"],expiresAt:"tomorrow"},
  {kind:"session",id:"s",scopes:[1],expiresAt:1}
 ])expect((await readSessionState(response(body))).kind).toBe("unreachable");
 const member=await readSessionState(response({kind:"session",id:"s",label:"Member",scopes:["client"],expiresAt:1}));
 expect(isConnected(member)).toBe(true);expect(isOwnerOrAdmin(member)).toBe(false);
 const owner=await readSessionState(response({kind:"session",id:"s",label:"Owner",scopes:["admin","client"],expiresAt:1}));
 expect(isOwnerOrAdmin(owner)).toBe(true);
});
it("clears malformed pairing credentials from history without crashing the sign-in screen",()=>{
 const replaceState=vi.fn();vi.stubGlobal("history",{replaceState});
 for(const code of ["%","%E0%A4%A","%GG"]){
  vi.stubGlobal("location",{pathname:"/pair",search:"?email=member%40example.test",hash:"#code="+code});
  expect(()=>takePairingCodeFromLocation()).not.toThrow();
  expect(takePairingCodeFromLocation()).toBeNull();
 }
 expect(replaceState).toHaveBeenCalledWith(null,"","/pair?email=member%40example.test");
 vi.stubGlobal("location",{pathname:"/pair",search:"",hash:"#code=ABCD-EFGH-JKLM"});
 expect(takePairingCodeFromLocation()).toBe("ABCD-EFGH-JKLM");
});
