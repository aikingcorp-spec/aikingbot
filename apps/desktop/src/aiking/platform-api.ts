// Copyright (c) 2026 AIKING.
import { platformEnabled } from "./platform-transport";
import { at } from "./strings";
export function managedServersEnabled(){return platformEnabled();}
export async function platformRequest<T>(path:string,body?:unknown,method=body?"POST":"GET",key?:string):Promise<T> {
 const response=await fetch("/api/platform/"+path,{method,credentials:"same-origin",cache:"no-store",
  headers:{"content-type":"application/json",...(key?{"idempotency-key":key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=await response.json();
 if(!response.ok) {
  const code=typeof result.error==="string"?result.error:"platform_error";
  const known:Record<string,string>={
   host_disk_low:at("server.diskLow"),host_memory_low:at("server.memoryLow"),host_server_limit:at("server.limit"),
   server_has_data:at("server.discardHasData"),provision_not_allowed:at("server.creationDenied"),platform_sign_in_required:at("server.signInRequired"),
  };
  throw new Error(known[code]||at("server.operationFailed",{code}));
 }
 return result as T;
}
export async function createManagedServer(name:string,key:string,progress:(status:string)=>void) {
 const result=await platformRequest<{server:{id:string;status:string}}>("servers",{name},"POST",key);
 const id=result.server.id,deadline=Date.now()+150_000;
 for(;;) {
  const next=await platformRequest<{server:{id:string;status:string;error?:string;url:string}}>("servers/"+encodeURIComponent(id));
  window.dispatchEvent(new Event("aiking:servers-changed"));progress(next.server.status);
  if(next.server.status==="ready"){location.assign(next.server.url);return;}
  if(next.server.status==="failed")throw new Error(at("server.operationFailed",{code:next.server.error||"provision_failed"}));
  if(Date.now()>deadline)throw new Error(at("server.stillProvisioning"));
  await new Promise(done=>setTimeout(done,1000));
 }
}
export async function discardFailedServer(id:string){
 await platformRequest<{ok:boolean}>("servers/"+encodeURIComponent(id),undefined,"DELETE");
 window.dispatchEvent(new Event("aiking:servers-changed"));
}
