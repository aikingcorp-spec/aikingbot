// Copyright (c) 2026 AIKING.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { request as httpRequest } from "node:http";
export const GiB = 1024 ** 3;
export const digest = value => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const validId = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export function email(value) {
  if (typeof value !== "string" || value.length > 254) return null;
  const text=value.trim().toLowerCase();
  return /^[^@\s\x00-\x1f]+@[^@\s\x00-\x1f]+\.[^@\s\x00-\x1f]+$/.test(text)?text:null;
}
export function text(value,max) {
  return typeof value==="string" && value.trim() && value.trim().length<=max && !/[\p{Cc}\p{Cf}]/u.test(value)?value.trim():null;
}
export function fail(status,code) {return Object.assign(new Error(code),{status,code});}
export function cookies(input) {
  const result=new Map();
  for(const part of (input||"").split(";")) {
    const i=part.indexOf("=");if(i>0)result.set(part.slice(0,i).trim(),part.slice(i+1).trim());
  }
  return result;
}
export function grant(key,claims) {
  const payload=Buffer.from(JSON.stringify({...claims,nonce:newToken(),expiresAt:Date.now()+30_000})).toString("base64url");
  return payload+"."+createHmac("sha256",key).update(payload).digest("base64url");
}
export function verifyGrant(key,value,now=Date.now()) {
  if(typeof value!=="string"||value.length>4096)return null;
  const [payload,signature,...extra]=value.split(".");
  if(!payload||!signature||extra.length)return null;
  const expected=Buffer.from(createHmac("sha256",key).update(payload).digest("base64url"));
  const actual=Buffer.from(signature);if(expected.length!==actual.length||!timingSafeEqual(expected,actual))return null;
  try {
    const data=JSON.parse(Buffer.from(payload,"base64url"));
    if(!Number.isFinite(data.expiresAt)||data.expiresAt<=now||data.expiresAt>now+31_000||typeof data.nonce!=="string")return null;
    return data;
  }catch{return null;}
}
export async function readJSON(req,max=32_768) {
  if(!/^application\/json\b/i.test(String(req.headers["content-type"]||"")))throw fail(415,"json_required");
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>max)throw fail(413,"body_too_large");chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks));}catch{throw fail(400,"invalid_json");}
}
export function json(res,status,body) {
  res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});
  res.end(JSON.stringify(body));
}
export function rpc(socketPath,body,timeout=120_000) {
  return new Promise((resolve,reject)=>{
    const raw=JSON.stringify(body);
    const request=httpRequest({socketPath,path:"/",method:"POST",headers:{"content-type":"application/json","content-length":Buffer.byteLength(raw)}},res=>{
      let chunks="";res.on("data",chunk=>{chunks+=chunk;if(chunks.length>100_000)request.destroy(fail(502,"worker_response_too_large"));});
      res.on("end",()=>{try{const data=JSON.parse(chunks);res.statusCode===200?resolve(data):reject(fail(res.statusCode||502,data.error||"worker_error"));}catch(error){reject(error);}});
    });
    request.setTimeout(timeout,()=>request.destroy(fail(504,"worker_timeout")));
    request.on("error",reject);request.end(raw);
  });
}
