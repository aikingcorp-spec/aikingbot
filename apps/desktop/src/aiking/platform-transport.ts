import { serverAPIPath } from "../../shared/server-scope.ts";
// Copyright (c) 2026 AIKING.
const enabled=typeof document!=="undefined"&&Boolean(document.querySelector('meta[name="aiking-platform"]'));
const prefix=enabled&&typeof location!=="undefined"?(/^\/servers\/[a-f0-9-]{36}/.exec(location.pathname)?.[0]||""):"";
export function platformEnabled(){return enabled;}
export { serverAPIPath } from "../../shared/server-scope.ts";
export function serverPagePath(value:string):string {
  if(!prefix)return value;
  const url=new URL(value,location.href);
  return url.origin===location.origin&&!url.pathname.startsWith(prefix+"/")?prefix+url.pathname+url.search+url.hash:value;
}
export function serverLocalPath(value:string):string {return prefix&&value.startsWith(prefix)?value.slice(prefix.length)||"/":value;}
if(enabled&&typeof window!=="undefined") {
 Reflect.set(globalThis,"__aikingServerScope",{prefix,origin:location.origin,href:location.href});
 const originalFetch=window.fetch.bind(window);
 window.fetch=(input,options)=>{
  if(input instanceof Request) {
   const next=serverAPIPath(input.url);
   return originalFetch(next===input.url?input:new Request(next,input),options);
  }
  return originalFetch(serverAPIPath(input),options);
 };
 const NativeEventSource=window.EventSource;
 if(NativeEventSource)window.EventSource=class extends NativeEventSource {
  constructor(url:string|URL,options?:EventSourceInit){super(serverAPIPath(url),options);}
 };
 const NativeWebSocket=window.WebSocket;
 if(NativeWebSocket)window.WebSocket=class extends NativeWebSocket {
  constructor(url:string|URL,protocols?:string|string[]){
   const value=new URL(String(url),location.href),web=value.protocol==="ws:"||value.protocol==="wss:";
   const http=web?new URL(value.href.replace(/^ws/,"http")):value;
   const routed=serverAPIPath(http);
   super(web?routed.replace(/^http/,"ws"):routed,protocols);
  }
 };
 if(prefix) {
  const get=Storage.prototype.getItem,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem;
  const global=new Set(["aiking-language","aiking-skin","aiking-font","aiking-font-size","aiking-interface-mode"]);
  const key=(storage:Storage,name:string)=>storage===localStorage&&!global.has(String(name))?"aiking:"+prefix+":"+String(name):String(name);
  Storage.prototype.getItem=function(name){return get.call(this,key(this,name));};
  Storage.prototype.setItem=function(name,value){return set.call(this,key(this,name),value);};
  Storage.prototype.removeItem=function(name){return remove.call(this,key(this,name));};
 }
}
