"""Guarded same-filesystem relocation. No OpenBot app/service changes beyond this integration unit."""
from pathlib import Path
import os,subprocess,json,time,signal,shutil,hashlib,pwd,socket,sys,datetime,stat
from backup_databases import main as backup,OLD,ROOT,dotenv,pgcmd
from bridge_service import Chatwoot
UNIT="aikingbot-zalo.service";LEGACY="aiking-zalo.service"
def run(args,**kw):return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kw)
def service_pids(unit):
 group=run(["systemctl","show",unit,"-p","ControlGroup","--value"],text=True).stdout.strip()
 if not group:return []
 p=Path("/sys/fs/cgroup"+group+"/cgroup.procs")
 return [int(x) for x in p.read_text().split()] if p.exists() else []
def url_ok(port,path="/health"):
 import urllib.request
 try:
  with urllib.request.urlopen(f"http://127.0.0.1:{port}"+path,timeout=3) as r:return r.status==200
 except Exception:return False
def paths_to_patch(cw,zca):
 paths=[cw/".env",zca/"app/.env"]
 paths+=list((cw/"bin").glob("*"))
 paths+=list((cw/"rootfs/pg/usr/lib/postgresql/18/bin").glob("*"))+list((cw/"rootfs/chatwoot/usr/local/bin").glob("*"))
 paths+=list((cw/"pgdata").glob("*.conf"))+list((zca/"runtime/pgdata").glob("*.conf"))
 paths+=list((cw/"rootfs/chatwoot/app/.bundle").glob("*"))
 paths+=list((cw/"rootfs/chatwoot/app/config").glob("*.yml"))
 return [p for p in paths if p.is_file() and not p.is_symlink() and p.stat().st_size<1024*1024]
def stage_files(checkpoint):
 cw=OLD/"chatwoot";zca=OLD/"zca-bridge"
 manifest={}
 for p in paths_to_patch(cw,zca):
  rel=p.relative_to(OLD);out=checkpoint/"originals"/rel;out.parent.mkdir(parents=True,exist_ok=True,mode=0o700);shutil.copy2(p,out);manifest[str(rel)]={"mode":stat.S_IMODE(p.stat().st_mode)}
 shutil.copyfile("/etc/systemd/system/"+LEGACY,checkpoint/LEGACY)
 (checkpoint/"original-files.json").write_text(json.dumps(manifest))
 return manifest
def main():
 if os.getuid()!=0:raise RuntimeError("Host service cutover requires root")
 os.umask(0o077)
 if shutil.disk_usage(ROOT).free<5*1024**3:raise RuntimeError("Insufficient disk reserve")
 for name in ["backup-restore.json","real-chatwoot-agent-pipeline.json","zca-real-receipts.json","live-agent-preflight.json","full-bridge-boot.json"]:
  if not json.loads((ROOT/"evidence"/name).read_text()).get("ok"):raise RuntimeError("Acceptance gate failed: "+name)
 current=ROOT/"runtime"
 if (current/"chatwoot").exists() or (current/"zca-bridge").exists():raise RuntimeError("Runtime target already exists; review state, do not overwrite")
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 checkpoint=ROOT/"checkpoints"/("cutover-"+stamp);checkpoint.mkdir(mode=0o700)
 (ROOT/"checkpoints/current-cutover.txt").write_text(str(checkpoint)+"\n")
 manifest=stage_files(checkpoint)
 before={name:{"inode":(OLD/name).stat().st_ino,"device":(OLD/name).stat().st_dev} for name in ["chatwoot","zca-bridge"]}
 (checkpoint/"original-runtime.json").write_text(json.dumps(before))
 # Backup runtime scripts/new-code hashes separately from any secrets.
 for p in [ROOT/"start_stack.py",ROOT/"bridge_service.py",ROOT/"aikingbot_transport.py"]:
  shutil.copy2(p,checkpoint/p.name)
 # Dedicated profile reproduces this stack's existing user-namespace permission; global OpenBot profile is unchanged.
 profile='abi <abi/4.0>,\ninclude <tunables/global>\nprofile aikingbot-zalo flags=(unconfined) {\n userns,\n}\n'
 apparmor=Path("/etc/apparmor.d/aikingbot-zalo")
 if apparmor.exists() and apparmor.read_text()!=profile:raise RuntimeError("Unexpected dedicated AppArmor profile; review needed")
 apparmor.write_text(profile);apparmor.chmod(0o644);run(["apparmor_parser","-r",str(apparmor)])
 unit=f"""[Unit]
Description=AIKINGBOT independent Zalo Chatwoot and Lisa Aimie router
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=10
[Service]
Type=simple
User=cadu
Group=cadu
WorkingDirectory={ROOT}
Environment=HOME={ROOT}/home
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/usr/bin/python3 {ROOT}/start_stack.py
Restart=on-failure
RestartSec=10
KillMode=control-group
TimeoutStopSec=65
UMask=0077
[Install]
WantedBy=multi-user.target
"""
 Path("/etc/systemd/system/"+UNIT).write_text(unit);run(["systemctl","daemon-reload"])
 who=pwd.getpwnam("cadu");(ROOT/"home").mkdir(exist_ok=True,mode=0o700);os.chown(ROOT/"home",who.pw_uid,who.pw_gid)
 # Ensure all mutable queue and service credentials remain readable only to the service user.
 for base in [ROOT/"secrets",ROOT/"state",ROOT/"business"]:
  for p in [base,*base.rglob("*")]:os.chown(p,who.pw_uid,who.pw_gid,follow_symlinks=False)
 moved=[];frozen=[];phase="prepared";start=time.time()
 try:
  # Stop ingress first and let Sidekiq finish/requeue work; never SIGKILL a busy Redis worker.
  pids=service_pids(LEGACY)
  main_pid=int(run(["systemctl","show",LEGACY,"-p","MainPID","--value"],text=True).stdout.strip())
  os.kill(main_pid,signal.SIGSTOP);sidekiq=[];ingress=[];hooks=[]
  for pid in pids:
   try:
    cmd=Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0",b" ").decode(errors="replace")
    cwd=str(Path(f"/proc/{pid}/cwd").resolve())
    if "sidekiq" in cmd:sidekiq.append(pid)
    elif "puma" in cmd or (cwd==str(OLD/"zca-bridge/app") and "dist/main.js" in cmd):ingress.append(pid)
    elif "/lisa-hook/server.py" in cmd or "/aimie-hook/server.py" in cmd:hooks.append(pid)
   except (OSError,ProcessLookupError):pass
  for pid in ingress+sidekiq:
   try:os.kill(pid,signal.SIGTERM)
   except ProcessLookupError:pass
  deadline=time.time()+40
  while any(Path(f"/proc/{pid}").exists() for pid in sidekiq+ingress) and time.time()<deadline:time.sleep(.25)
  if any(Path(f"/proc/{pid}").exists() for pid in sidekiq+ingress):raise RuntimeError("Ingress/Sidekiq did not stop gracefully; aborting cutover")
  for pid in hooks:
   try:os.kill(pid,signal.SIGTERM)
   except ProcessLookupError:pass
  frozen=service_pids(LEGACY)
  for pid in frozen:
   try:os.kill(pid,signal.SIGSTOP)
   except ProcessLookupError:pass
  database_pids=[]
  for pid in frozen:
   try:
    cmd=Path(f"/proc/{pid}/cmdline").read_bytes().replace(b"\0",b" ").decode(errors="replace")
    if "postgres" in cmd or "redis-server" in cmd:
     os.kill(pid,signal.SIGCONT);database_pids.append(pid)
   except ProcessLookupError:pass
  phase="quiesced";backup()
  # Redis SAVE creates a valid runtime snapshot; no running PGDATA is copied.
  cwenv=dotenv(OLD/"chatwoot/.env");redis=OLD/"chatwoot/rootfs/redis"
  run([str(redis/"lib/ld-musl-x86_64.so.1"),"--library-path",str(redis/"lib")+":"+str(redis/"usr/lib"),str(redis/"usr/local/bin/redis-cli"),"-h","127.0.0.1","-p","6379","SAVE"],env={**os.environ,"REDISCLI_AUTH":cwenv["REDIS_PASSWORD"]})
  shutil.copy2(OLD/"chatwoot/redisdata/dump.rdb",checkpoint/"redis-dump.rdb")
  for pid in frozen:
   if pid not in database_pids:
    try:os.kill(pid,signal.SIGKILL)
    except ProcessLookupError:pass
  run(["systemctl","stop",LEGACY],timeout=75);phase="stopped"
  for name in ["chatwoot","zca-bridge"]:
   (OLD/name).rename(current/name);moved.append(name)
   assert (current/name).stat().st_ino==before[name]["inode"]
  phase="relocated"
  cw=current/"chatwoot";zca=current/"zca-bridge"
  for p in paths_to_patch(cw,zca):
   try:s=p.read_text()
   except UnicodeDecodeError:continue
   for name in ["chatwoot","zca-bridge"]:s=s.replace(str(OLD/name),str(current/name))
   p.write_text(s)
  # Legacy hooks and daemon starter are retained only as rollback artifacts, never in the active entrypoint.
  archived=checkpoint/"legacy-hooks";archived.mkdir(mode=0o700)
  for name in ["lisa-hook","aimie-hook","resilience"]:
   (cw/name).rename(archived/name)
  if (cw/"start_stack.sh").exists():(cw/"start_stack.sh").rename(archived/"start_stack.sh")
  olddist=checkpoint/"zca-dist";(zca/"app/dist").rename(olddist)
  shutil.copytree(ROOT/"zca-bridge/dist",zca/"app/dist")
  for p in [zca/"app/dist",*list((zca/"app/dist").rglob("*"))]:os.chown(p,who.pw_uid,who.pw_gid,follow_symlinks=False)
  # Build-time dependency link now points at AIKINGBOT-owned modules.
  link=ROOT/"zca-bridge/node_modules";link.unlink();link.symlink_to(zca/"app/node_modules",target_is_directory=True)
  for p in (cw/"bin").glob("*"):
   if p.is_file():os.chown(p,who.pw_uid,who.pw_gid)
  for p in [cw/".env",zca/"app/.env",*list((cw/"pgdata").glob("*.conf")),*list((zca/"runtime/pgdata").glob("*.conf"))]:
   os.chown(p,who.pw_uid,who.pw_gid);p.chmod(0o600)
  cfg=json.loads((ROOT/"settings.json").read_text());cfg["production_enabled"]=True;(ROOT/"settings.json").write_text(json.dumps(cfg,indent=2));os.chown(ROOT/"settings.json",who.pw_uid,who.pw_gid)
  run(["systemctl","start",UNIT]);phase="started"
  deadline=time.time()+105
  while time.time()<deadline:
   if all(url_ok(p) for p in [3025,3026]) and url_ok(4000,"/healthz") and url_ok(3010,"/"):break
   time.sleep(2)
  else:raise RuntimeError("Independent stack health did not become ready")
  # Never accept an old/outside daemon merely because the port responds.
  import re
  listeners=run(["ss","-ltnp"],text=True).stdout
  for port in [6379,54330,5432,3010,4000,3025,3026]:
   line=next((line for line in listeners.splitlines() if re.search(r":"+str(port)+r"\s",line)),None)
   if not line:raise RuntimeError("Missing qualified listener "+str(port))
   ids=re.findall(r"pid=(\d+)",line)
   if not ids or any("/aikingbot-zalo.service" not in Path("/proc/"+pid+"/cgroup").read_text() for pid in ids):raise RuntimeError("Listener is outside the integration unit: "+str(port))
  # Authentication must still work, not merely listener 200.
  cwapi=Chatwoot(ROOT/"secrets/chatwoot.token")
  inboxes=cwapi.api("inboxes");assert inboxes
  run(["systemctl","enable",UNIT]);run(["systemctl","disable",LEGACY])
  phase="healthy"
  result={"ok":True,"phase":phase,"checkpoint":str(checkpoint),"new_service":UNIT,"legacy_service_stopped":True,"relocated_same_inodes":before,"downtime_upper_bound_seconds":round(time.time()-start,1),"no_rootfs_copy":True}
  (ROOT/"evidence/cutover.json").write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
 except BaseException as exc:
  info={"ok":False,"phase":phase,"moved":moved,"checkpoint":str(checkpoint),"error":type(exc).__name__+":"+str(exc)[:500]}
  (ROOT/"evidence/cutover.json").write_text(json.dumps(info,indent=2));print(json.dumps(info),flush=True)
  # Unfreeze untouched production if relocation never began; otherwise invoke the concrete rollback script.
  if not moved:
   if "main_pid" in locals():
    try:os.kill(main_pid,signal.SIGCONT)
    except ProcessLookupError:pass
   for pid in frozen:
    try:os.kill(pid,signal.SIGCONT)
    except ProcessLookupError:pass
   run(["systemctl","start",LEGACY])
  else:
   run(["/usr/bin/python3",str(ROOT/"rollback.py"),str(checkpoint)],timeout=150)
  raise
if __name__=="__main__":main()
