// Copyright (c) 2026 AIKING.
export function serverAPIPath(value:string|URL):string {
 const text=String(value);
 const scope=Reflect.get(globalThis,"__aikingServerScope") as {prefix?:string;origin?:string;href?:string}|undefined;
 if(!scope?.prefix||!scope.origin||!scope.href)return text;
 try {
  const url=new URL(text,scope.href);
  if(url.origin!==scope.origin||url.pathname.startsWith("/api/platform/"))return text;
  if(!/^\/(api\/|\.well-known\/|v1\/)/.test(url.pathname))return text;
  return url.origin+scope.prefix+url.pathname+url.search+url.hash;
 }catch{return text;}
}
