// Copyright (c) 2026 AIKING.
import { createServer,request as httpRequest } from "node:http";
import { readFileSync,existsSync,mkdirSync,realpathSync,statSync,chmodSync,unlinkSync,createReadStream } from "node:fs";
import { resolve,join,extname,sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "./registry.mjs";
import { digest,newToken,email,text,fail,cookies,grant,readJSON,json,rpc,validId } from "./common.mjs";
const COOKIE="__Host-aiking_platform";
const ALLOWED_ROUTES=/^\/(api\/|\.well-known\/|v1\/|hooks\/|mcp-oauth\/callback$)/;
const MIME={".js":"application/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon",".webp":"image/webp",".woff2":"font/woff2",".woff":"font/woff",".ttf":"font/ttf",".json":"application/json",".html":"text/html"};
const HOP=new Set(["connection","keep-alive","proxy-authenticate","proxy-authorization","te","trailer","transfer-encoding","upgrade","set-cookie","content-length","content-encoding"]);
function memberLists(input,creator) {
  if(!input||!Array.isArray(input.admins)||!Array.isArray(input.members)||input.admins.length+input.members.length>100)throw fail(400,"invalid_membership");
  const normalize=value=>email(value)||(typeof value==="string"&&/^@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)?value.toLowerCase():null);
  const admins=[...new Set(input.admins.map(normalize))],members=[...new Set(input.members.map(normalize))];
  if([...admins,...members].some(x=>!x)||!admins.includes(creator))throw fail(400,"creator_must_remain_owner");
  return{admins,members:members.filter(x=>!admins.includes(x))};
}
export class Platform {
 constructor(config,{registry,workerRPC=rpc}={}) {
  this.config=config;this.registry=registry||new Registry(config.database);this.workerRPC=workerRPC;
  this.connections=new Map();this.active=new Set();this.limits=new Map();this.challenges=new Map();this.jobs=false;this.memberLocks=new Map();this.healthCache=new Map();
 }
 cookie(res,token) {res.setHeader("set-cookie",COOKIE+"="+token+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age="+(token?30*86400:0));}
 identify(req,res) {
  const parsed=cookies(req.headers.cookie);
  let user=this.registry.authenticate(parsed.get(COOKIE));
  if(!user&&this.config.bootstrapCookie) {
   const migrated=this.registry.bootstrap(parsed.get(this.config.bootstrapCookie));
   if(migrated) {this.cookie(res,migrated.token);user=this.registry.authenticate(migrated.token);}
  }
  return user;
 }
 limit(key,max,ms) {
  const now=Date.now();let state=this.limits.get(key);
  if(!state||state.until<=now){state={count:0,until:now+ms};this.limits.set(key,state);}
  if(++state.count>max)throw fail(429,"rate_limited");
  if(this.limits.size>2000)for(const [k,v]of this.limits)if(v.until<=now)this.limits.delete(k);
  if(this.limits.size>4000)throw fail(503,"rate_table_full");
 }
 checkOrigin(req) {
  if(req.headers.origin&&req.headers.origin!==this.config.origin)throw fail(403,"origin_denied");
  if(/^(?:\/servers\/[a-f0-9-]{36})?\/hooks\//.test(req.url))return;
  if(["GET","HEAD","OPTIONS"].includes(req.method))return;
  const path=new URL(req.url,this.config.origin).pathname;
  if(!req.headers.origin&&req.headers.authorization&&!path.startsWith("/api/platform/")&&!path.includes("/api/auth/email/"))return;
  if(req.headers.origin!==this.config.origin)throw fail(403,"origin_required");
 }
 canCreate(user){return Boolean(user&&this.config.creationEmails.includes(user.email));}
 serverURL(id){return id===this.config.defaultServer?"/":"/servers/"+id+"/";}
 async directory(user,activeId) {
  const rows=this.registry.list(user);
  const servers=await Promise.all(rows.map(async server=>{
   let status=server.status;
   if(status==="ready"&&this.registry.server(server.id).managed){
    let cached=this.healthCache.get(server.id);
    if(!cached||cached.until<Date.now()){
     try{const live=await this.workerRPC(this.config.workerSocket,{action:"status",id:server.id},5000);cached={until:Date.now()+5000,status:live.phase};}
     catch{cached={until:Date.now()+5000,status:"offline"};}
     this.healthCache.set(server.id,cached);
    }
    status=cached.status;
   }
   return{id:server.id,name:server.name,role:server.role,status,error:server.error||null,local:false,missing:status==="failed",url:this.serverURL(server.id)};
  }));
  return{activeId,canCreate:this.canCreate(user),provider:"managed",servers};
 }

 async backendSession(server,user,role) {
  const cacheKey=server.id+":"+user.sessionHash;
  const cached=this.connections.get(cacheKey);
  if(cached&&cached.role===role&&cached.expiresAt>Date.now()+60_000)return cached;
  if(!server.base_url||!server.secret)throw fail(503,"server_not_ready");
  const response=await fetch(server.base_url+"/api/platform/runtime-session",{
   method:"POST",headers:{"content-type":"application/json","host":new URL(this.config.origin).host,"x-forwarded-proto":"https","x-forwarded-host":new URL(this.config.origin).host,"x-forwarded-for":"203.0.113.250"},
   body:JSON.stringify({grant:grant(server.secret,{aud:server.id,userId:user.id,email:user.email,role,label:("AIKINGBOT · "+user.email).slice(0,80)})}),
   signal:AbortSignal.timeout(10_000),redirect:"error",
  });
  if(!response.ok)throw fail(503,"runtime_auth_unavailable");
  const body=await response.json();
  if(typeof body.workspaceToken!=="string"||!body.session?.id)throw fail(502,"invalid_runtime_session");
  const result={token:body.workspaceToken,accountCookie:body.accountCookie,sessionId:body.session.id,role,expiresAt:body.session.expiresAt};
  this.connections.set(cacheKey,result);if(this.connections.size>1000)this.connections.delete(this.connections.keys().next().value);
  return result;
 }
 checkConnectionLimit(user,serverId) {
  if(this.active.size>=256||[...this.active].filter(c=>c.serverId===serverId&&c.sessionHash===user?.sessionHash).length>=16)throw fail(429,"connection_limit");
 }
 closeConnections(serverId) {
  for(const connection of this.active)if(connection.serverId===serverId)connection.close();
  for(const key of this.connections.keys())if(key.startsWith(serverId+":"))this.connections.delete(key);
 }
 async authAPI(path,body) {
  const response=await fetch(this.config.authAPI+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(15_000)});
  const value=await response.json().catch(()=>({}));
  if(!response.ok)throw fail(response.status===429?429:401,typeof value.error?.code==="string"?value.error.code:"authentication_failed");
  return value;
 }
 async emailSignIn(req,res,path) {
  this.limit("auth-ip:"+String(req.headers["x-forwarded-for"]||""),15,600_000);
  const body=await readJSON(req),address=email(body.email);
  if(!address)throw fail(400,"invalid_email");
  const now=Date.now();
  for(const [key,value]of this.challenges)if(value.expiresAt<=now)this.challenges.delete(key);
  if(path.endsWith("/start")) {
   this.limit("otp:"+address,3,600_000);
   if(this.challenges.size>=1000)throw fail(503,"challenge_limit");
   const result=await this.authAPI("/v1/auth/email/start",{email:address});
   if(!text(result.challengeId,128))throw fail(502,"invalid_auth_response");
   this.challenges.set(address,{id:result.challengeId,expiresAt:Math.min(result.expiresAt||now+600_000,now+600_000)});
   return json(res,200,{ok:true});
  }
  const code=typeof body.code==="string"?body.code.toUpperCase().replace(/[\s-]/g,""):"";
  if(!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(code))throw fail(400,"invalid_otp");
  const challenge=this.challenges.get(address);if(!challenge||challenge.expiresAt<=now)throw fail(401,"challenge_expired");
  this.limit("verify:"+address,8,600_000);
  const result=await this.authAPI("/v1/auth/email/verify",{challengeId:challenge.id,code:code.slice(0,4)+"-"+code.slice(4)});
  if(email(result.user?.email)!==address||typeof result.user?.id!=="string"||!result.sessionToken)throw fail(502,"invalid_auth_response");
  this.challenges.delete(address);
  const user=this.registry.user(result.user.id,address),issued=this.registry.issue(user);this.cookie(res,issued.token);
  return json(res,200,{ok:true,account:{email:user.email},workspace:this.registry.list(user).length>0});
 }
 async processJobs() {
  if(this.jobs)return;this.jobs=true;
  try {
   for(const server of this.registry.pending()) {
    try {
     const result=await this.workerRPC(this.config.workerSocket,{action:"create",id:server.id,name:server.name,owner:server.owner_email,secret:server.secret});
     if(result.phase!=="ready"||!/^http:\/\/127\.0\.0\.1:\d+$/.test(result.baseURL))throw fail(503,"runtime_health_failed");
     this.registry.ready(server.id,result.baseURL);
    }catch(error){this.registry.failed(server.id,error.code||"provision_failed");}
   }
  }finally{this.jobs=false;if(this.registry.pending().length)void this.processJobs();}
 }
 async changeMembers(server,user,lists) {
  const previous=this.memberLocks.get(server.id)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
   const normalized=memberLists(lists,server.owner_email);
   this.registry.requireMember(server.id,user,true);
   const auth=await this.backendSession(server,user,"owner");
   const response=await fetch(server.base_url+"/api/config",{method:"PUT",headers:{
    authorization:"Bearer "+auth.token,"content-type":"application/json",host:new URL(this.config.origin).host,
    origin:this.config.origin,"x-forwarded-proto":"https","x-forwarded-host":new URL(this.config.origin).host,"x-forwarded-for":"203.0.113.250",
   },body:JSON.stringify({signIn:normalized}),signal:AbortSignal.timeout(10_000),redirect:"error"});
   if(!response.ok)throw fail(503,"membership_sync_failed");
   this.registry.setMembers(server.id,normalized,user.email);this.closeConnections(server.id);
   return await response.json();
  });
  this.memberLocks.set(server.id,next);
  try{return await next;}finally{if(this.memberLocks.get(server.id)===next)this.memberLocks.delete(server.id);}
 }
 async api(req,res,url,user,activeId) {
  const path=url.pathname;
  if(path==="/api/platform/session")return json(res,200,{enabled:true,authenticated:Boolean(user),identity:user?{userId:user.id,email:user.email}:null});
  if(!user)throw fail(401,"platform_sign_in_required");
  if(path==="/api/platform/servers"&&req.method==="GET"){this.limit("directory:"+user.id,120,60_000);const requested=url.searchParams.get("active");if(requested&&this.registry.role(requested,user.email))activeId=requested;return json(res,200,await this.directory(user,activeId));}
  if(path==="/api/platform/servers"&&req.method==="POST") {
   if(!this.canCreate(user))throw fail(403,"provision_not_allowed");
   const body=await readJSON(req),name=text(body.name,60),key=req.headers["idempotency-key"];
   if(!name||Object.keys(body).some(x=>x!=="name")||typeof key!=="string"||!/^[\w-]{16,80}$/.test(key))throw fail(400,"invalid_create_request");
   this.limit("create:"+user.id,5,60_000);
   const server=this.registry.create(user,name,key);void this.processJobs();
   return json(res,202,{server:{id:server.id,name:server.name,status:server.status}});
  }
  const match=/^\/api\/platform\/servers\/([^/]+)(?:\/(members|invites|status))?$/.exec(path);
  if(match) {
   const {server,role}=this.registry.requireMember(match[1],user,["POST","PUT","DELETE"].includes(req.method)&&match[2]!=="status");
   if(!match[2]&&req.method==="DELETE") {
    if(!server.managed||server.status!=="failed")throw fail(409,"only_failed_servers_can_be_removed");
    let kept=false;
    try{const live=await this.workerRPC(this.config.workerSocket,{action:"status",id:server.id},5000);kept=live.allocatedBytes>0;}
    catch(error){if(error.status!==404)throw error;}
    if(kept)throw fail(409,"server_has_data");
    this.registry.discard(server.id,user.email);this.healthCache.delete(server.id);
    return json(res,200,{ok:true});
   }
   if(!match[2]&&req.method==="GET")return json(res,200,{server:{id:server.id,name:server.name,status:server.status,error:server.error,url:this.serverURL(server.id)}});
   if(match[2]==="members"&&req.method==="GET")return json(res,200,{members:this.registry.members(server.id),role});
   if(match[2]==="members"&&req.method==="PUT"){const body=await readJSON(req);await this.changeMembers(server,user,body);return json(res,200,{ok:true,members:this.registry.members(server.id)});}
   if(match[2]==="invites"&&req.method==="POST") {
    const body=await readJSON(req),address=email(body.email);if(!address)throw fail(400,"invalid_email");
    const rows=this.registry.members(server.id),lists={admins:rows.filter(x=>x.role==="owner").map(x=>x.email),members:rows.filter(x=>x.role==="member").map(x=>x.email)};
    if(!lists.admins.includes(address)&&!lists.members.includes(address))lists.members.push(address);
    await this.changeMembers(server,user,lists);
    return json(res,200,{ok:true,url:this.config.origin+"/servers/"+server.id+"/pair?email="+encodeURIComponent(address)});
   }
   if(match[2]==="status"&&req.method==="GET") {
    const status=server.managed?await this.workerRPC(this.config.workerSocket,{action:"status",id:server.id}):{phase:server.status};
    return json(res,200,{status});
   }
  }
  if(path==="/api/platform/logout"&&req.method==="POST")return this.logout(req,res,user);
  throw fail(404,"not_found");
 }
 logout(req,res,user) {
  this.registry.logout(user);
  const clear=[COOKIE+"=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0"];
  for(const name of cookies(req.headers.cookie).keys())if(/^aiking_session_|^aikingbot_account_/.test(name))clear.push(name+"=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0");
  res.setHeader("set-cookie",clear);return json(res,200,{ok:true});
 }
 rewriteJSON(value,scope,key="") {
  if(Array.isArray(value))return value.map(item=>this.rewriteJSON(item,scope,key));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.rewriteJSON(v,scope,k)]));
  if(typeof value==="string"&&/(url|href|src)$/i.test(key)&&scope) {
   if(value.startsWith("/api/")||value.startsWith("/pair")||value.startsWith("/desktop-viewer"))return scope+value;
   if(value.startsWith(this.config.origin+"/api/")||value.startsWith(this.config.origin+"/pair")||value.startsWith(this.config.origin+"/desktop-viewer"))return this.config.origin+scope+value.slice(this.config.origin.length);
   if(key==="publicUrl"&&value===this.config.origin)return value+scope;
  }
  return value;
 }
 async proxy(req,res,server,path,scope,user) {
  if(path.startsWith("/api/platform/"))throw fail(404,"not_found");
  if(user&&path.split("?")[0]==="/api/account/session"&&req.method==="GET") {
   const defaults=this.registry.server(this.config.defaultServer);
   let devices=[];if(this.registry.role(defaults.id,user.email)) {
    try{const credential=await this.backendSession(defaults,user,this.registry.role(defaults.id,user.email));
      if(credential.accountCookie){const r=await fetch(defaults.base_url+"/api/account/session",{headers:{cookie:credential.accountCookie.split(";")[0]},signal:AbortSignal.timeout(3000)});if(r.ok)devices=(await r.json()).devices||[];}
    }catch{}
   }
   return json(res,200,{account:{email:user.email},workspaces:this.registry.list(user).map(s=>({id:s.id,name:s.name,role:s.role,current:s.id===server.id})),devices,hostedComputers:"not-offered"});
  }
  if(user&&path.split("?")[0]==="/api/auth/session"&&!this.registry.role(server.id,user.email))return json(res,401,{error:"server_access_denied"});
  const publicRoute=path.split("?")[0]==="/.well-known/aikingbot/environment"||path.startsWith("/hooks/")||path.startsWith("/mcp-oauth/callback");
  let auth=null;
  if(user&&!publicRoute) {const {role}=this.registry.requireMember(server.id,user);if(server.status!=="ready")throw fail(503,"server_not_ready");auth=await this.backendSession(server,user,role);}
  else if(!publicRoute&&server.id!==this.config.defaultServer)throw fail(401,"platform_sign_in_required");
  if(user&&path.split("?")[0]==="/api/auth/logout"&&req.method==="POST")return this.logout(req,res,user);
  let rawBody;
  if(user&&path.split("?")[0]==="/api/config"&&["PUT","PATCH"].includes(req.method)) {
   const body=await readJSON(req,1024*1024);
   if(body.signIn) {
    this.registry.requireMember(server.id,user,true);
    if(Object.keys(body).length!==1)throw fail(400,"membership_requires_separate_update");
    const result=await this.changeMembers(server,user,body.signIn);return json(res,200,this.rewriteJSON(result,scope));
   }
   rawBody=Buffer.from(JSON.stringify(body));
  }
  const destination=new URL(server.base_url+path);
  const headers={...req.headers,host:new URL(this.config.origin).host,"x-forwarded-host":new URL(this.config.origin).host,"x-forwarded-proto":"https"};
  delete headers["x-aiking-platform-auth"];delete headers["accept-encoding"];
  if(auth) {
   headers.authorization="Bearer "+auth.token;delete headers.cookie;
   if(path.startsWith("/api/account/")&&auth.accountCookie){delete headers.authorization;headers.cookie=auth.accountCookie.split(";")[0];}
  } else if(server.id===this.config.defaultServer) {
   headers.cookie=[...cookies(req.headers.cookie)].filter(([name])=>name!==COOKIE).map(([k,v])=>k+"="+v).join("; ");
  } else delete headers.cookie;
  if(rawBody)headers["content-length"]=String(rawBody.length);
  this.checkConnectionLimit(user,server.id);
  return new Promise((resolveProxy,reject)=>{
   const upstream=httpRequest(destination,{method:req.method,headers},response=>{
    response.on("error",reject);
    const received={};for(const [key,value]of Object.entries(response.headers))if(!HOP.has(key)&&value!==undefined)received[key]=value;
    if(!auth&&response.headers["set-cookie"])received["set-cookie"]=response.headers["set-cookie"];
    received["cache-control"]="no-store";
    if(typeof received.location==="string")received.location=this.rewriteJSON(received.location,scope,"url");
    const isJSON=/application\/json/.test(String(response.headers["content-type"]||""));
    if(isJSON) {
     const chunks=[];let bytes=0;
     response.on("data",chunk=>{bytes+=chunk.length;if(bytes>16*1024*1024)upstream.destroy(fail(502,"runtime_response_too_large"));else chunks.push(chunk);});
     response.on("end",()=>{
      try{const value=JSON.parse(Buffer.concat(chunks));res.writeHead(response.statusCode,received);res.end(JSON.stringify(this.rewriteJSON(value,scope)));resolveProxy();}
      catch{reject(fail(502,"invalid_runtime_response"));}
     });return;
    }
    if(/text\/html|javascript|svg\+xml/.test(String(received["content-type"]||"")))received["content-security-policy"]="sandbox; default-src 'none'";
    res.writeHead(response.statusCode,received);response.pipe(res);
    const entry={serverId:server.id,sessionHash:user?.sessionHash,close:()=>{response.destroy();res.destroy();}};this.active.add(entry);
    response.once("end",()=>{this.active.delete(entry);resolveProxy();});response.once("close",()=>this.active.delete(entry));
   });
   upstream.on("error",reject);
   req.once("aborted",()=>upstream.destroy());res.once("close",()=>{if(!res.writableEnded)upstream.destroy();});
   if(rawBody)upstream.end(rawBody);else req.pipe(upstream);
   upstream.setTimeout(130_000,()=>upstream.destroy(fail(504,"runtime_timeout")));
  });
 }
 scoped(url) {
  const match=/^\/servers\/([a-f0-9-]{36})(\/.*|$)/.exec(url.pathname);
  return{serverId:match?match[1]:this.config.defaultServer,scope:match?"/servers/"+match[1]:"",path:match?(match[2]||"/"):url.pathname};
 }
 serveStatic(req,res,path) {
  if(!["GET","HEAD"].includes(req.method))throw fail(404,"not_found");
  const root=realpathSync(this.config.staticDir);
  let decoded;try{decoded=decodeURIComponent(path);}catch{throw fail(400,"invalid_path");}
  if(decoded.split("/").some(part=>part===".."||part.startsWith("."))||decoded.includes("\\")||/[\x00-\x1f]/.test(decoded))throw fail(404,"not_found");
  let file=resolve(root,"."+decoded);if(!file.startsWith(root+sep))file=join(root,"index.html");
  if(!existsSync(file)||!statSync(file).isFile())file=join(root,"index.html");
  file=realpathSync(file);if(!file.startsWith(root+sep))throw fail(404,"not_found");
  const type=MIME[extname(file)]||"application/octet-stream";
  res.setHeader("content-type",type);res.setHeader("x-content-type-options","nosniff");res.setHeader("referrer-policy","same-origin");
  res.setHeader("content-security-policy","frame-ancestors 'self'; object-src 'none'; base-uri 'self'");
  res.setHeader("cache-control",type==="text/html"?"no-cache":path.startsWith("/assets/")?"public,max-age=31536000,immutable":"no-cache");
  if(req.method==="HEAD"){res.end();return;}
  if(type==="text/html"){res.end(readFileSync(file,"utf8").replace("<head>",'<head><meta name="aiking-platform" content="enabled">'));return;}
  createReadStream(file).pipe(res);
 }
 async handle(req,res) {
  try {
   const url=new URL(req.url,this.config.origin),{serverId,scope,path}=this.scoped(url);
   this.checkOrigin(req);const user=this.identify(req,res);
   if(url.pathname.startsWith("/api/platform/"))return await this.api(req,res,url,user,serverId);
   if(path==="/api/auth/email/start"||path==="/api/auth/email/verify")return await this.emailSignIn(req,res,path);
   if(user&&/^\/api\/account\/workspaces\/[^/]+\/enter$/.test(path)&&req.method==="POST") {
    const id=path.split("/")[4];this.registry.requireMember(id,user);return json(res,200,{ok:true,url:this.serverURL(id)});
   }
   if(path==="/api/account/logout"&&req.method==="POST"&&user)return this.logout(req,res,user);
   if(ALLOWED_ROUTES.test(path)) {
    const server=this.registry.server(serverId);if(!server)throw fail(404,"unknown_server");
    return await this.proxy(req,res,server,path+url.search,scope,user);
   }
   return this.serveStatic(req,res,path);
  }catch(error){if(!res.headersSent)json(res,error.status||500,{error:error.code||"platform_error"});else res.destroy();}
 }
 async upgrade(req,socket,head) {
  try {
   const url=new URL(req.url,this.config.origin),{serverId,path}=this.scoped(url);
   if(req.headers.origin&&req.headers.origin!==this.config.origin)throw fail(403,"origin_denied");
   if(!ALLOWED_ROUTES.test(path)||path.startsWith("/api/platform/"))throw fail(404,"not_found");
   const user=this.registry.authenticate(cookies(req.headers.cookie).get(COOKIE));if(!user)throw fail(401,"platform_sign_in_required");
   const {server,role}=this.registry.requireMember(serverId,user);const auth=await this.backendSession(server,user,role);
   this.checkConnectionLimit(user,serverId);
   const headers={...req.headers,host:new URL(this.config.origin).host,authorization:"Bearer "+auth.token,"x-forwarded-host":new URL(this.config.origin).host,"x-forwarded-proto":"https"};delete headers.cookie;delete headers["x-aiking-platform-auth"];
   const upstream=httpRequest(server.base_url+path+url.search,{headers});
   upstream.on("upgrade",(response,remote,buffer)=>{
    socket.write("HTTP/1.1 101 Switching Protocols\r\n"+Object.entries(response.headers).map(([k,v])=>k+": "+v).join("\r\n")+"\r\n\r\n");
    if(buffer.length)socket.write(buffer);if(head.length)remote.write(head);
    remote.pipe(socket);socket.pipe(remote);
    const entry={serverId,sessionHash:user.sessionHash,close:()=>{remote.destroy();socket.destroy();}};this.active.add(entry);
    socket.on("close",()=>{this.active.delete(entry);remote.destroy();});remote.on("close",()=>socket.destroy());
   });
   upstream.on("response",response=>{socket.end("HTTP/1.1 "+response.statusCode+" Refused\r\nConnection: close\r\n\r\n");response.resume();});
   upstream.on("error",()=>socket.destroy());upstream.end();
  }catch{socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");}
 }
}
async function main() {
 process.umask(0o077);const config=JSON.parse(readFileSync(process.env.AIKING_PLATFORM_CONFIG));
 const platform=new Platform(config),server=createServer((req,res)=>void platform.handle(req,res));
 server.on("upgrade",(req,socket,head)=>void platform.upgrade(req,socket,head));
 server.requestTimeout=120_000;server.headersTimeout=15_000;server.maxHeadersCount=80;
 if(existsSync(config.socket))unlinkSync(config.socket);
 server.listen(config.socket,()=>{chmodSync(config.socket,0o660);console.log("AIKINGBOT platform ready");void platform.processJobs();});
 const shutdown=()=>{for(const connection of platform.active)connection.close();server.close(()=>{platform.registry.close();process.exit(0);});};
 process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
