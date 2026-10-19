"""Boot the complete compiled bridge with restored disposable DB, zero Zalo accounts/jobs and loopback binding."""
from pathlib import Path
import subprocess,os,json,time,urllib.request,urllib.parse,shutil,pwd
from backup_databases import ROOT,OLD,pgcmd,dotenv
cw=dotenv(OLD/"chatwoot/.env");env={**os.environ,"PGPASSWORD":cw["POSTGRES_PASSWORD"]}
args=["-h","127.0.0.1","-p",cw["POSTGRES_PORT"],"-U",cw["POSTGRES_USERNAME"]]
name="aiking_fullboot_fixture_"+str(os.getpid());proc=None
report={"real_zalo_sessions_started":False,"production_data_modified":False}
def sql(text,db="postgres"):
 return subprocess.run(pgcmd("psql")+args+["-d",db,"-v","ON_ERROR_STOP=1","-t","-A","-c",text],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.decode().strip()
fixture=ROOT/"evidence/full-boot-fixture";fixture.mkdir(exist_ok=True,mode=0o700)
who=pwd.getpwnam("cadu")
try:
 sql("CREATE DATABASE "+name)
 checkpoint=Path((ROOT/"checkpoints/latest-database-checkpoint.txt").read_text().strip())
 r=subprocess.run(pgcmd("pg_restore")+args+["-d",name,"--no-owner","--no-acl","--exit-on-error",str(checkpoint/"zca.dump")],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
 sql("TRUNCATE zalo_accounts CASCADE;TRUNCATE job_queue;DELETE FROM settings;",name)
 for p in [fixture,ROOT/"zca-bridge/dist",*list((ROOT/"zca-bridge/dist").rglob("*"))]:os.chown(p,who.pw_uid,who.pw_gid,follow_symlinks=False)
 cfg=dotenv(OLD/"zca-bridge/app/.env")
 cfg.update({"DATABASE_URL":"postgresql://"+urllib.parse.quote(cw["POSTGRES_USERNAME"],safe="")+":"+urllib.parse.quote(cw["POSTGRES_PASSWORD"],safe="")+"@127.0.0.1:"+cw["POSTGRES_PORT"]+"/"+name,"PORT":"14000","BIND_HOST":"127.0.0.1","MEDIA_ARCHIVE_ROOT":str(fixture/"archive")})
 cfg["PUBLIC_BASE_URL"]="http://127.0.0.1:14000";cfg["CHATWOOT_BASE_URL"]="http://127.0.0.1:9"
 log=open(fixture/"node.log","wb")
 proc=subprocess.Popen(["runuser","-u","cadu","--","node",str(ROOT/"zca-bridge/dist/main.js")],env={**os.environ,**cfg},stdout=log,stderr=log)
 deadline=time.time()+30
 while time.time()<deadline:
  if proc.poll() is not None:raise RuntimeError("Full bridge exited; inspect private fixture node.log")
  try:
   with urllib.request.urlopen("http://127.0.0.1:14000/healthz",timeout=1) as f:
    if f.status==200:break
  except Exception:pass
  time.sleep(.5)
 else:raise RuntimeError("Full bridge failed to become healthy")
 for path in ["/admin/","/admin/admin.js"]:
  with urllib.request.urlopen("http://127.0.0.1:14000"+path,timeout=5) as f:assert f.status==200
 for path in ["/typing","/reaction","/undo"]:
  req=urllib.request.Request("http://127.0.0.1:14000"+path,data=b"{}",headers={"content-type":"application/json"})
  try:urllib.request.urlopen(req,timeout=5);raise AssertionError("Unauthenticated control route accepted")
  except urllib.error.HTTPError as error:assert error.code in (401,403)
 report["ok"]=True;report["empty_zalo_accounts"]=int(sql("SELECT count(*) FROM zalo_accounts",name))
 assert report["empty_zalo_accounts"]==0
except Exception as e:report["ok"]=False;report["error"]=type(e).__name__+":"+str(e)[:500]
finally:
 if proc:
  proc.terminate()
  try:proc.wait(timeout=10)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
 sql("DROP DATABASE "+name+" WITH(FORCE)")
 report["cleaned"]=True;(ROOT/"evidence/full-bridge-boot.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
