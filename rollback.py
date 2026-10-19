"""Rollback integration service/code paths, preserving current customer data and queues."""
from pathlib import Path
import os,sys,json,subprocess,shutil,time
ROOT=Path(__file__).resolve().parent
OLD=Path("/var/lib/openbot/OpenBot/Shared/AIKING")
def run(args):return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def main():
 if os.getuid()!=0:raise RuntimeError("Root required")
 checkpoint=Path(sys.argv[1]).resolve()
 if checkpoint.parent!=ROOT/"checkpoints" or not (checkpoint/"original-files.json").exists():raise RuntimeError("Invalid rollback checkpoint")
 subprocess.run(["systemctl","stop","aikingbot-zalo.service"],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 subprocess.run(["systemctl","disable","aikingbot-zalo.service"],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 current=ROOT/"runtime";cw=current/"chatwoot";zca=current/"zca-bridge"
 archived=checkpoint/"legacy-hooks"
 if cw.exists() and archived.exists():
  for p in archived.iterdir():
   target=cw/p.name
   if target.exists():raise RuntimeError("Refusing to overwrite "+p.name)
   p.rename(target)
 if zca.exists() and (checkpoint/"zca-dist").exists():
  if (zca/"app/dist").exists():(zca/"app/dist").rename(checkpoint/"failed-candidate-dist")
  (checkpoint/"zca-dist").rename(zca/"app/dist")
 for name in ["chatwoot","zca-bridge"]:
  active=current/name
  if active.exists():
   if (OLD/name).exists():raise RuntimeError("Refusing to overwrite original runtime")
   active.rename(OLD/name)
 manifest=json.loads((checkpoint/"original-files.json").read_text())
 for rel in manifest:
  src=checkpoint/"originals"/rel;target=OLD/rel
  shutil.copy2(src,target)
  import pwd
  user=pwd.getpwnam("cadu");os.chown(target,user.pw_uid,user.pw_gid)
 link=ROOT/"zca-bridge/node_modules"
 if link.is_symlink():link.unlink();link.symlink_to(OLD/"zca-bridge/app/node_modules",target_is_directory=True)
 shutil.copy2(checkpoint/"aiking-zalo.service","/etc/systemd/system/aiking-zalo.service")
 run(["systemctl","daemon-reload"]);run(["systemctl","enable","aiking-zalo.service"]);run(["systemctl","start","aiking-zalo.service"])
 cfg=json.loads((ROOT/"settings.json").read_text());cfg["production_enabled"]=False;(ROOT/"settings.json").write_text(json.dumps(cfg,indent=2))
 (ROOT/"evidence/rollback.json").write_text(json.dumps({"rolled_back":True,"checkpoint":str(checkpoint),"customer_data_restored_from_backup":False,"current_data_preserved":True}))
 print("ROLLBACK_COMPLETE: original integration restarted; current data preserved")
if __name__=="__main__":main()
