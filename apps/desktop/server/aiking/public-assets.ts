// Copyright (c) 2026 AIKING.
import {closeSync,constants,existsSync,fstatSync,openSync,readFileSync,realpathSync,statSync} from "node:fs";
import {isAbsolute,relative,resolve,sep} from "node:path";
const contained=(root:string,file:string)=>{
 const part=relative(root,file);
 return part!=="" && part!==".." && !part.startsWith(".."+sep) && !isAbsolute(part);
};
const unavailable=()=>new Error("Public asset unavailable");
/** Public HTTP must never turn a build-directory link into a reader outside that directory. */
export function readPublicAsset(directory:string,path:string):Buffer {
 let decoded:string;
 try{decoded=decodeURIComponent(path);}catch{throw unavailable();}
 // eslint-disable-next-line no-control-regex -- public paths must not include ASCII controls
 if(!decoded.startsWith("/") || decoded.includes("\\") || /[\x00-\x1f\x7f]/.test(decoded) ||
    decoded.split("/").some(part=>part.startsWith(".")))throw unavailable();
 const root=realpathSync(directory);
 const candidate=resolve(root,"."+decoded);
 if(!contained(root,candidate))throw unavailable();
 const before=realpathSync(candidate);
 if(!contained(root,before))throw unavailable();
 let fd:number|undefined;
 try {
  fd=openSync(before,constants.O_RDONLY | (constants.O_NOFOLLOW??0) | (constants.O_NONBLOCK??0));
  const opened=fstatSync(fd);
  if(!opened.isFile())throw unavailable();
  const after=realpathSync(candidate);
  if(!contained(root,after))throw unavailable();
  const current=statSync(after);
  if(opened.dev!==current.dev || opened.ino!==current.ino)throw unavailable();
  if(process.platform==="linux" && existsSync("/proc/self/fd")){
   const actual=realpathSync("/proc/self/fd/"+fd);
   if(!contained(root,actual))throw unavailable();
  }
  return readFileSync(fd);
 } finally {if(fd!==undefined)closeSync(fd);}
}
