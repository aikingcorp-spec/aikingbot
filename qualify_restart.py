"""Publish the reviewed bridge code, then verify the real systemd restart preserves queued identities."""
from pathlib import Path
import os,json,subprocess,pwd,shutil,sqlite3,hashlib,time,urllib.request,urllib.error
ROOT=Path(__file__).resolve().parent
cp=Path((ROOT/"checkpoints/current-cutover.txt").read_text().strip());who=pwd.getpwnam("cadu")
def queues():
 result={}
 for agent in ["lisa","aimie"]:
  with sqlite3.connect(ROOT/"state"/agent/"queue.sqlite3") as db:rows=db.execute("SELECT key,state,thread,outgoing FROM jobs ORDER BY key").fetchall()
  result[agent]={"count":len(rows),"digest":hashlib.sha256(json.dumps(rows).encode()).hexdigest()}
 return result
before=queues()
assert json.loads((ROOT/"evidence/full-bridge-boot.json").read_text())["ok"]
manifest=json.loads((cp/"original-files.json").read_text());runtime=ROOT/"runtime/zca-bridge/app"
for rel in ["src/main.ts","src/handlers/inbound.ts","src/handlers/outbound.ts","src/handlers/deliveryGuard.ts"]:
 target=runtime/rel
 if target.exists() and "zca-bridge/app/"+rel not in manifest:
  archived=cp/"originals/zca-bridge/app"/rel;archived.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,archived);manifest["zca-bridge/app/"+rel]={"mode":target.stat().st_mode&511}
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/"zca-bridge"/rel,target);os.chown(target,who.pw_uid,who.pw_gid)
(cp/"original-files.json").write_text(json.dumps(manifest))
for rel in ["main.js","main.js.map"]:
 shutil.copy2(ROOT/"zca-bridge/dist"/rel,runtime/"dist"/rel);os.chown(runtime/"dist"/rel,who.pw_uid,who.pw_gid)
start=time.time();subprocess.run(["systemctl","restart","aikingbot-zalo.service"],check=True)
deadline=time.time()+100
while time.time()<deadline:
 try:
  for port,path in [(3010,"/"),(4000,"/healthz"),(3025,"/health"),(3026,"/health")]:
   with urllib.request.urlopen(f"http://127.0.0.1:{port}"+path,timeout=3) as f:assert f.status==200
  break
 except Exception:time.sleep(2)
else:raise RuntimeError("Post-restart health failed")
after=queues();assert before==after,"Queued identities/state changed during idle restart"
for path in ["/typing","/reaction","/undo"]:
 try:
  urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:4000"+path,data=b"{}",headers={"content-type":"application/json"}),timeout=5)
  raise AssertionError("Anonymous control route accepted")
 except urllib.error.HTTPError as e:assert e.code in (401,403)
report={"ok":True,"real_systemd_restart":True,"seconds":round(time.time()-start,1),"queues_before":before,"queues_after":after,"unauthenticated_control_routes_denied":True}
(ROOT/"evidence/service-restart.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
