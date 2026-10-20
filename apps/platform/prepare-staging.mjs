// Copyright (c) 2026 AIKING.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync,chmodSync,chownSync,readdirSync,cpSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Registry} from "./registry.mjs";
import {GiB,newToken,email,validId} from "./common.mjs";
const ROOT="/srv/aikingbot-staging";
const repo=resolve(fileURLToPath(new URL("../..",import.meta.url)));
const run=(bin,args)=>execFileSync(bin,args,{encoding:"utf8"}).trim();
const save=(path,value,mode=0o600)=>{writeFileSync(path,value,{mode});chmodSync(path,mode);};
function envFile(path){return Object.fromEntries(readFileSync(path,"utf8").split("\n").flatMap(line=>{const m=/^([A-Z0-9_]+)=(.*)$/.exec(line);return m?[[m[1],m[2].replace(/^["']|["']$/g,"")]]:[];}));}
function main() {
 if(process.getuid()!==0)throw new Error("Run staging preparation as root");
 const commit=process.argv[2];if(!/^[a-f0-9]{7,40}$/.test(commit||""))throw new Error("Expected a reviewed source commit");
 const tag=commit.slice(0,7),image="aikingbot-server:0.3.0-rc.2-"+tag;
 const release=join(ROOT,"server/releases/0.3.0-rc.2-"+tag);
 if(!existsSync(join(release,"bundle-manifest.json")))throw new Error("Server release missing");
 const manifest=JSON.parse(readFileSync(join(release,"bundle-manifest.json")));if(!manifest.commit.startsWith(commit))throw new Error("Bundle commit mismatch");
 const environment=envFile(join(ROOT,"server/aikingbot.env"));
 const origin="https://"+environment.AIKING_TRAEFIK_HOST;
 const accountAPI=new URL(environment.AIKING_ACCOUNT_API_URL).origin;
 const creatorEmails=String(environment.AIKING_WORKSPACE_OWNERS||"").split(/[,;\s]+/).map(email).filter(Boolean);
 if(!creatorEmails.length)throw new Error("Existing owner identity required");
 const data=join(ROOT,"server-data/.aikingbot"),defaultId=readFileSync(join(data,"environment-id"),"utf8").trim();
 if(!validId(defaultId))throw new Error("Unexpected existing environment identity");
 const live=JSON.parse(readFileSync(join(data,"aiking/account-directory.json"))),config=JSON.parse(readFileSync(join(data,"config.json")));
 const platform=join(ROOT,"platform"),state=join(platform,"state"),code=join(platform,"releases",tag);
 mkdirSync(platform,{recursive:true,mode:0o755});chmodSync(platform,0o755);mkdirSync(join(ROOT,"platform-host"),{recursive:true,mode:0o700});
 mkdirSync(state,{recursive:true,mode:0o700});mkdirSync(code,{recursive:true,mode:0o755});
 try{run("getent",["passwd","aiking-platform"]);}catch{run("useradd",["--system","--home-dir",state,"--no-create-home","--shell","/usr/sbin/nologin","aiking-platform"]);}
 const account=run("id",["-u","aiking-platform"]),group=run("id",["-g","aiking-platform"]);
 chownSync(state,Number(account),Number(group));chmodSync(state,0o700);
 for(const name of ["common.mjs","registry.mjs","server.mjs","worker.mjs"]){copyFileSync(join(repo,"apps/server-platform",name),join(code,name));chmodSync(join(code,name),0o644);}
 const registry=new Registry(join(state,"manager.db"));
 if(!registry.server(defaultId)) {
  const known=new Set();
  registry.transaction(()=>{
   for(const record of live.sessions||[]) {
    const address=email(record.email);if(!address||!record.userId||!/^[a-f0-9]{64}$/.test(record.tokenHash)||record.expiresAt<=Date.now())continue;
    const user=registry.user(record.userId,address);known.add(address);
    registry.db.prepare("INSERT OR IGNORE INTO bootstrap(hash,user_id,expires,consumed) VALUES(?,?,?,0)").run(record.tokenHash,user.id,record.expiresAt);
   }
   const name=environment.AIKING_WORKSPACE_NAME||environment.AIKING_SERVER_LABEL||"AIKINGBOT staging";
   registry.db.prepare("INSERT INTO servers VALUES(?,?,?,?,?,?,?,?,?,?)").run(defaultId,name,creatorEmails[0],"ready","http://127.0.0.1:"+(environment.AIKING_HTTP_PORT||18080),newToken(),0,Date.now(),"existing-server",null);
   const insert=registry.db.prepare("INSERT OR IGNORE INTO members VALUES(?,?,?)");
   for(const address of [...creatorEmails,...(config.signIn?.admins||[])])insert.run(defaultId,address.toLowerCase(),"owner");
   for(const address of config.signIn?.members||[])insert.run(defaultId,address.toLowerCase(),"member");
  });
 }
 const legacy=registry.server(defaultId);
 registry.close();
 for(const file of readdirSync(state))chownSync(join(state,file),Number(account),Number(group));
 for(const dir of ["/run/aikingbot-platform","/run/aikingbot-provisioner"]){mkdirSync(dir,{recursive:true});chmodSync(dir,0o750);chownSync(dir,dir.endsWith("platform")?Number(account):0,Number(group));}
 const checkpoint=join(ROOT,"backups","pre-platform-"+tag+"-"+new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+Z$/,"Z"));
 mkdirSync(checkpoint,{mode:0o700});copyFileSync(join(ROOT,"server/aikingbot.env"),join(checkpoint,"server.env"));chmodSync(join(checkpoint,"server.env"),0o600);
 const previous=run("readlink",["-f",join(ROOT,"server/current")]);save(join(checkpoint,"previous-release.txt"),previous+"\n");
 save(join(checkpoint,"README.txt"),"Configuration-only checkpoint. No user database archive. New platform sessions are separate. Rollback preserves all A/B data; stop managed runtimes and invalidate platform sessions/bootstrap before restoring the old gateway.\n");
 const worker={
 root:join(ROOT,"platform-host"),socket:"/run/aikingbot-provisioner/worker.sock",managerGid:Number(group),
 image,imageId:run("docker",["image","inspect","--format","{{.Id}}",image]),edgeImage:"caddy:2.10.2",
 origin,authAPI:accountAPI,maxServers:2,quotaBytes:4*GiB,memoryBytes:2*GiB,reserveBytes:10*GiB,portBase:28900,testMode:false,
 };
 const manager={database:join(state,"manager.db"),socket:"/run/aikingbot-platform/http.sock",workerSocket:worker.socket,
 staticDir:join(release,"dist"),origin,authAPI:accountAPI,defaultServer:defaultId,creationEmails:creatorEmails,
 bootstrapCookie:"aikingbot_account_"+defaultId.replaceAll("-","").slice(0,12),
 };
 save(join(platform,"worker.json"),JSON.stringify(worker,null,2));save(join(platform,"manager.json"),JSON.stringify(manager,null,2),0o640);chownSync(join(platform,"manager.json"),0,Number(group));
 save(join(platform,"prepared.json"),JSON.stringify({tag,commit,code,checkpoint,previous,defaultId,privatePort:18891,platformUser:Number(account),platformGroup:Number(group)},null,2));
 save(join(platform,"runtime-key.env"),"AIKING_PLATFORM_RUNTIME_KEY="+legacy.secret+"\nAIKING_PLATFORM_SERVER_ID="+defaultId+"\n");
 const workerUnit=`[Unit]
Description=AIKINGBOT bounded staging provisioner
After=docker.service
Requires=docker.service
[Service]
Type=simple
Environment=AIKING_PROVISION_CONFIG=${platform}/worker.json
ExecStart=/usr/bin/node ${code}/worker.mjs
User=root
Group=aiking-platform
RuntimeDirectory=aikingbot-provisioner
RuntimeDirectoryMode=0750
UMask=0077
NoNewPrivileges=yes
Restart=on-failure
RestartSec=3
TimeoutStopSec=135
[Install]
WantedBy=multi-user.target
`;
 const managerUnit=`[Unit]
Description=AIKINGBOT staging server directory and gateway
After=docker.service aiking-provisioner-staging.service
Requires=aiking-provisioner-staging.service
[Service]
Type=simple
User=aiking-platform
Group=aiking-platform
RuntimeDirectory=aikingbot-platform
RuntimeDirectoryMode=0750
RuntimeDirectoryPreserve=yes
UMask=0077
Environment=AIKING_PLATFORM_CONFIG=${platform}/manager.json
ExecStart=/usr/bin/node ${code}/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=${state} /run/aikingbot-platform
InaccessiblePaths=/var/run/docker.sock ${ROOT}/platform-host ${ROOT}/server-data
PrivateTmp=yes
TimeoutStopSec=15
[Install]
WantedBy=multi-user.target
`;
 save(join(platform,"aiking-provisioner-staging.service"),workerUnit,0o644);
 save(join(platform,"aiking-platform-staging.service"),managerUnit,0o644);
 console.log(JSON.stringify({prepared:true,tag,defaultServer:defaultId,checkpoint,legacyDataChanged:false,platformDatabaseNew:true,maxNewServers:2,quotaGiB:4,memoryGiB:2}));
}
main();
