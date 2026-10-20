// Copyright (c) 2026 AIKING.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,renameSync,chmodSync,statSync,statfsSync,rmSync,unlinkSync,lstatSync,chownSync } from "node:fs";
import { join,resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GiB,validId,email,text,digest,fail,readJSON,json } from "./common.mjs";
const exec=promisify(execFile);
async function command(bin,args,timeout=90_000) {
  try{return (await exec(bin,args,{timeout,maxBuffer:512_000,encoding:"utf8"})).stdout.trim();}
  catch(error){const failure=fail(503,error.killed?"host_operation_timeout":"host_operation_failed");failure.operation=bin;failure.detail=String(error.stderr||"").slice(0,1800);throw failure;}
}
export class Provisioner {
  constructor(config) {
    this.config=config;this.root=resolve(config.root);
    if(!this.root.startsWith("/srv/aikingbot-staging/")&&!(config.testMode&&this.root.startsWith("/tmp/aiking-provision-verify-")))throw new Error("Invalid managed data root");
    mkdirSync(this.root,{recursive:true,mode:0o700});
    if(lstatSync(this.root).isSymbolicLink())throw new Error("Unsafe data root");
    this.busy=false;
  }
  path(id){if(!validId(id))throw fail(400,"invalid_server_id");return join(this.root,id);}
  read(id){const p=join(this.path(id),"host.json");return existsSync(p)?JSON.parse(readFileSync(p)):null;}
  save(meta) {
    const dir=this.path(meta.id);mkdirSync(dir,{recursive:true,mode:0o700});
    if(lstatSync(dir).isSymbolicLink())throw fail(503,"unsafe_data_directory");
    const file=join(dir,"host.json");writeFileSync(file+".tmp",JSON.stringify(meta),{mode:0o600});renameSync(file+".tmp",file);
  }
  all(){return readdirSync(this.root).filter(validId).map(id=>this.read(id)).filter(Boolean);}
  names(id){const prefix=(this.config.testMode?"aiking-pv-test-":"aiking-pv-")+id;return{app:prefix+"-app",edge:prefix+"-edge",network:prefix+"-net"};}
  async admission() {
    const allocated=this.all().filter(m=>m.phase!=="failed"||existsSync(join(this.path(m.id),"data.img")));
    if(allocated.length>=this.config.maxServers)throw fail(409,"host_server_limit");
    const memory=Number(/^MemAvailable:\s+(\d+)/m.exec(readFileSync("/proc/meminfo","utf8"))?.[1]||0)*1024;
    if(memory<this.config.memoryBytes+2*GiB)throw fail(507,"host_memory_low");
    const rootStat=statfsSync(this.root);
    const reserved=allocated.reduce((sum,m)=>{
      const file=join(this.path(m.id),"data.img");const used=existsSync(file)?statSync(file).blocks*512:0;
      return sum+Math.max(0,this.config.quotaBytes-used);
    },0);
    if(rootStat.bavail*rootStat.bsize-reserved-this.config.quotaBytes<this.config.reserveBytes)throw fail(507,"host_disk_low");
  }
  async mount(meta) {
    const dir=this.path(meta.id),image=join(dir,"data.img"),mount=join(dir,"data");
    mkdirSync(mount,{recursive:true,mode:0o700});
    if(lstatSync(mount).isSymbolicLink())throw fail(503,"unsafe_mount");
    let mounted=false;try{await exec("mountpoint",["-q",mount]);mounted=true;}catch{}
    if(mounted) {
      const uuid=await command("findmnt",["-n","-o","UUID","--target",mount]);
      if(uuid!==meta.uuid)throw fail(503,"wrong_data_mount");
    } else await command("mount",["-o","loop,nodev,nosuid",image,mount]);
    const actual=await command("findmnt",["-n","-o","UUID","--target",mount]);
    if(actual!==meta.uuid)throw fail(503,"wrong_data_mount");
    return mount;
  }
  async ownedRemove(kind,name,id) {
    let label;
    try {label=await command("docker",[kind,"inspect","--format",kind==="container"?'{{index .Config.Labels "aiking.server-id"}}':'{{index .Labels "aiking.server-id"}}',name]);}
    catch{return;}
    if(label!==id)throw fail(503,"resource_ownership_mismatch");
    await command("docker",kind==="container"?["rm","-f",name]:["network","rm",name]);
  }
  async create(input) {
    const allowed=["action","id","name","owner","secret"];
    if(Object.keys(input).some(key=>!allowed.includes(key))||!validId(input.id)||!text(input.name,60)||!email(input.owner)||!/^[-\w]{43}$/.test(input.secret||""))throw fail(400,"invalid_provision_request");
    if(this.busy)throw fail(409,"worker_busy");
    this.busy=true;
    let meta=this.read(input.id);
    try {
      if(meta) {
        if(meta.secretHash!==digest(input.secret)||meta.owner!==input.owner)throw fail(409,"server_identity_mismatch");
        if(meta.phase==="ready")return this.status(input.id);
      } else {
        await this.admission();
        if(this.config.imageId&&await command("docker",["image","inspect","--format","{{.Id}}",this.config.image])!==this.config.imageId)throw fail(503,"runtime_image_changed");
        const slots=new Set(this.all().filter(m=>m.phase!=="failed"||existsSync(join(this.path(m.id),"data.img"))).map(m=>m.slot));
        const slot=Array.from({length:this.config.maxServers},(_,i)=>i).find(i=>!slots.has(i));
        meta={id:input.id,name:input.name,owner:input.owner,secretHash:digest(input.secret),slot,phase:"allocating",createdAt:Date.now(),handedOff:false};
        this.save(meta);
      }
      const dir=this.path(meta.id),image=join(dir,"data.img");
      if(!meta.uuid) {
        if(!existsSync(image))await command("truncate",["-s",String(this.config.quotaBytes),image]);
        chmodSync(image,0o600);
        await command("mkfs.ext4",["-q","-F","-m","0",image]);
        meta.uuid=await command("blkid",["-s","UUID","-o","value",image]);this.save(meta);
      }
      const data=await this.mount(meta);
      await command("chown",["10001:10001",data]);await command("chmod",["0700",data]);
      const appData=join(data,".aikingbot");
      if(!existsSync(appData)) {
        mkdirSync(appData,{mode:0o700});await command("chown",["10001:10001",appData]);
        writeFileSync(join(appData,"environment-id"),meta.id+"\n",{mode:0o600});
        const initial={signIn:{admins:[meta.owner],members:[]},onboarding:{completedAt:new Date().toISOString(),version:1,reelSeen:false,hintsSeen:[]}};
        if(this.config.testMode&&this.config.fixtureCli)Object.assign(initial,{instances:{fixture:{driver:"claudeAgent",displayName:"Verification fixture",config:{cli:this.config.fixtureCli},environment:{FAKE_CLAUDE_REPLIES:JSON.stringify(["Verification reply from this isolated Server"]),FAKE_CLAUDE_TOOL_CALLS:"[]"}}},defaultModelSelection:{instanceId:"fixture",model:"claude-sonnet-5"}});
        writeFileSync(join(appData,"config.json"),JSON.stringify(initial),{mode:0o600});
        await command("chown",["10001:10001",join(appData,"environment-id"),join(appData,"config.json")]);
      }
      const lines={
        HOME:"/data",AIKING_DATA_DIR:"/data/.aikingbot",AIKING_PORT:"8799",AIKING_WEBHOOK_PORT:"8800",AIKING_LOOPBACK_TRUST:"service",
        AIKING_STRICT_SERVICE_LOOPBACK:"1",AIKING_PLATFORM_RUNTIME_KEY:input.secret,AIKING_PLATFORM_SERVER_ID:meta.id,
        AIKING_WORKSPACE_OWNERS:meta.owner,AIKING_WORKSPACE_NAME:meta.name,AIKING_SERVER_LABEL:meta.name,
        AIKING_ACCOUNT_API_URL:this.config.authAPI,AIKING_PUBLIC_URL:this.config.origin+"/servers/"+meta.id,
      };
      writeFileSync(join(dir,"runtime.env"),Object.entries(lines).map(([key,value])=>key+"="+value).join("\n")+"\n",{mode:0o600});
      writeFileSync(join(dir,"Caddyfile"),"{\n admin off\n servers {\n trusted_proxies static private_ranges\n }\n}\n:80 {\n handle /hooks/* {\n reverse_proxy 127.0.0.1:8800\n }\n handle {\n reverse_proxy 127.0.0.1:8799 {\n flush_interval -1\n }\n }\n}\n",{mode:0o644});
      const names=this.names(meta.id),label=["--label","aiking.managed=provisioner","--label","aiking.server-id="+meta.id];
      for(const name of [names.app,names.edge])await this.ownedRemove("container",name,meta.id);
      let networkExists=false;try{await command("docker",["network","inspect",names.network]);networkExists=true;}catch{}
      if(!networkExists)await command("docker",["network","create",...label,names.network]);
      await command("docker",["run","-d","--name",names.edge,...label,"--network",names.network,"--memory","96m","--cpus","0.25","--pids-limit","64",
        "--read-only","--tmpfs","/data:rw,nosuid,nodev,size=16777216","--tmpfs","/config:rw,nosuid,nodev,size=4194304","--tmpfs","/tmp:rw,nosuid,nodev,size=16777216","--cap-drop","ALL","--cap-add","NET_BIND_SERVICE","--security-opt","no-new-privileges:true","--restart","on-failure:3","--log-opt","max-size=5m","--log-opt","max-file=2",
        "-p","127.0.0.1:"+String(this.config.portBase+meta.slot)+":80","--mount","type=bind,src="+join(dir,"Caddyfile")+",dst=/etc/caddy/Caddyfile,readonly",this.config.edgeImage]);
      await command("docker",["run","-d","--name",names.app,...label,"--network","container:"+names.edge,"--memory",String(this.config.memoryBytes),
        "--cpus","1.0","--pids-limit","256","--shm-size","256m","--init","--cap-drop","ALL","--security-opt","no-new-privileges:true",
        "--read-only","--restart","on-failure:3","--log-opt","max-size=10m","--log-opt","max-file=3","--tmpfs","/tmp:rw,nosuid,nodev,size=268435456",
        "--env-file",join(dir,"runtime.env"),"--mount","type=bind,src="+data+",dst=/data",this.config.image]);
      meta.phase="starting";this.save(meta);
      const baseURL="http://127.0.0.1:"+(this.config.portBase+meta.slot);
      const deadline=Date.now()+90_000;
      for(;;) {
        try{if((await fetch(baseURL+"/api/health",{signal:AbortSignal.timeout(2000)})).ok)break;}catch{}
        if(Date.now()>deadline)throw fail(503,"runtime_health_failed");
        await new Promise(done=>setTimeout(done,500));
      }
      meta.phase="ready";meta.handedOff=true;this.save(meta);
      return this.status(meta.id);
    }catch(error) {
      if(meta&&!meta.handedOff) {
        if(this.config.testMode){try{const logs=await exec("docker",["logs","--tail","12",this.names(meta.id).edge]);error.detail=(error.detail||"")+String(logs.stderr||logs.stdout).slice(0,4000);}catch{}}
        const names=this.names(meta.id);
        for(const name of [names.app,names.edge])await this.ownedRemove("container",name,meta.id).catch(()=>{});
        await this.ownedRemove("network",names.network,meta.id).catch(()=>{});
        meta.phase="failed";this.save(meta);
      }
      throw error;
    }finally{this.busy=false;}
  }
  async status(id) {
    const meta=this.read(id);if(!meta)throw fail(404,"unknown_server");
    const image=join(this.path(id),"data.img");
    let phase=meta.phase;
    if(phase==="ready"){
      try{const r=await fetch("http://127.0.0.1:"+(this.config.portBase+meta.slot)+"/api/health",{signal:AbortSignal.timeout(1500)});if(!r.ok)phase="offline";}
      catch{phase="offline";}
    }
    return{id,phase,baseURL:"http://127.0.0.1:"+(this.config.portBase+meta.slot),quotaBytes:this.config.quotaBytes,allocatedBytes:existsSync(image)?statSync(image).blocks*512:0};
  }
  async recover() {
    for(const meta of this.all().filter(m=>m.phase==="ready")) {
      await this.mount(meta);
      const names=this.names(meta.id);
      for(const name of [names.edge,names.app])await command("docker",["start",name]);
    }
  }
  async cleanupTest(id) {
    if(!this.config.testMode)throw fail(403,"production_data_deletion_disabled");
    const meta=this.read(id);if(!meta)throw fail(404,"unknown_server");
    const names=this.names(id);
    for(const name of [names.app,names.edge])await this.ownedRemove("container",name,id);
    await this.ownedRemove("network",names.network,id);
    const mount=join(this.path(id),"data");
    try{await exec("mountpoint",["-q",mount]);await command("umount",[mount]);}catch(error){if(error.code!=="ENOENT"&&error.status)throw error;}
    rmSync(this.path(id),{recursive:true,force:true});
  }
}
async function main() {
  process.umask(0o077);
  const config=JSON.parse(readFileSync(process.env.AIKING_PROVISION_CONFIG));
  const worker=new Provisioner(config);
  if(process.argv[2]==="--cleanup-test"){await worker.cleanupTest(process.argv[3]);return;}
  await worker.recover();
  mkdirSync(resolve(config.socket,".."),{recursive:true,mode:0o750});
  if(existsSync(config.socket))unlinkSync(config.socket);
  const server=createServer(async(req,res)=>{
    try {
      if(req.method!=="POST"||req.url!=="/")throw fail(404,"not_found");
      const body=await readJSON(req);
      if(body.action==="create")return json(res,200,await worker.create(body));
      if(body.action==="status"&&validId(body.id))return json(res,200,await worker.status(body.id));
      throw fail(400,"unsupported_worker_action");
    }catch(error){json(res,error.status||500,{error:error.code||"worker_failure"});}
  });
  server.requestTimeout=135_000;server.headersTimeout=10_000;
  server.listen(config.socket,()=>{chmodSync(config.socket,0o660);chownSync(config.socket,0,config.managerGid);console.log("Provisioner ready");});
  const close=()=>server.close(()=>process.exit(0));process.on("SIGTERM",close);process.on("SIGINT",close);
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
