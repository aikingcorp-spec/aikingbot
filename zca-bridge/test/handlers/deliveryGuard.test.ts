import {describe,it,expect,vi} from "vitest";
import {DeliveryGuard} from "../../src/handlers/deliveryGuard.js";
function fixture(){
 const rows=new Map<string,any>();let failCommit=false;
 const pool={query:vi.fn(async(sql:string,args:any[]=[])=>{
  const key=args[0];
  if(sql.startsWith("CREATE"))return{rows:[],rowCount:0};
  if(sql.startsWith("INSERT")){
   if(rows.has(key))return{rows:[],rowCount:0};
   rows.set(key,{state:"sending"});return{rows:[{delivery_key:key}],rowCount:1};
  }
  if(sql.startsWith("SELECT"))return{rows:[rows.get(key)],rowCount:1};
  if(sql.includes("state='sent'")){
   if(failCommit)throw new Error("db lost after remote send");
   rows.set(key,{state:"sent",receipt:JSON.parse(args[1])});return{rows:[],rowCount:1};
  }
  rows.set(key,{state:"uncertain"});return{rows:[],rowCount:1};
 })};
 return{pool,rows,setFail:()=>{failCommit=true;}};
}
describe("outbound side effect boundary",()=>{
 it("successful retries and new worker instances reuse the persisted receipt",async()=>{
  const f=fixture(),send=vi.fn(async()=>({msgId:"zalo-fixture"}));
  const first=new DeliveryGuard(f.pool as any);await first.init();
  expect(await first.once(1,"text",send)).toEqual({msgId:"zalo-fixture"});
  expect(await new DeliveryGuard(f.pool as any).once(1,"text",send)).toEqual({msgId:"zalo-fixture"});
  expect(send).toHaveBeenCalledTimes(1);
 });
 it("an ambiguous provider timeout is never replayed",async()=>{
  const f=fixture(),send=vi.fn(async()=>{throw new Error("lost provider response");}),g=new DeliveryGuard(f.pool as any);
  await expect(g.once(2,"text",send)).rejects.toThrow();
  await expect(g.once(2,"text",send)).rejects.toThrow("UNCERTAIN");expect(send).toHaveBeenCalledTimes(1);
 });
 it("lost local receipt after remote success cannot duplicate a Zalo send on restart",async()=>{
  const f=fixture();f.setFail();const send=vi.fn(async()=>({msgId:"sent-before-db-failed"}));
  await expect(new DeliveryGuard(f.pool as any).once(3,"text",send)).rejects.toThrow("db lost");
  await expect(new DeliveryGuard(f.pool as any).once(3,"text",send)).rejects.toThrow("UNCERTAIN");expect(send).toHaveBeenCalledTimes(1);
 });
});
