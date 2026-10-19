"""Transaction-consistent pg_dump archives and roles; never a copy of running PGDATA."""
from pathlib import Path
import os,subprocess,json,datetime,hashlib,urllib.parse
ROOT=Path(__file__).resolve().parent
ORIGINAL=Path("/var/lib/openbot/OpenBot/Shared/AIKING")
OLD=ORIGINAL if (ORIGINAL/"chatwoot").exists() else ROOT/"runtime"
def dotenv(path):
 result={}
 for ln in path.read_text().splitlines():
  if "=" in ln and not ln.startswith("#"):
   k,v=ln.split("=",1);result[k]=v.strip().strip("\"'")
 return result
def pgcmd(name):
 root=OLD/"chatwoot/rootfs/pg"
 return [str(root/"lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"),"--library-path",str(root/"usr/lib/x86_64-linux-gnu")+":"+str(root/"lib/x86_64-linux-gnu"),str(ROOT/"tools/pg_dumpall") if name=="pg_dumpall" else str(root/"usr/lib/postgresql/18/bin"/name)]
def main():
 os.umask(0o077);cw=dotenv(OLD/"chatwoot/.env");zca=urllib.parse.urlsplit(dotenv(OLD/"zca-bridge/app/.env")["DATABASE_URL"])
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder=ROOT/"checkpoints"/("db-"+stamp);folder.mkdir(mode=0o700)
 meta={"consistent_pg_dump":True,"running_pgdata_copied":False,"databases":{}}
 specs=[("chatwoot",cw["POSTGRES_HOST"],int(cw["POSTGRES_PORT"]),cw["POSTGRES_USERNAME"],cw["POSTGRES_PASSWORD"],cw["POSTGRES_DATABASE"]),("zca",zca.hostname,zca.port or 5432,zca.username,zca.password,zca.path.lstrip("/"))]
 for name,host,port,user,password,db in specs:
  env={**os.environ,"PGPASSWORD":password};args=["-h",host,"-p",str(port),"-U",user]
  path=folder/(name+".dump")
  with path.open("wb") as f:subprocess.run(pgcmd("pg_dump")+args+["-Fc","-d",db],env=env,stdout=f,stderr=subprocess.PIPE,check=True)
  with (folder/(name+"-roles.sql")).open("wb") as f:subprocess.run(pgcmd("pg_dumpall")+args+["--globals-only"],env=env,stdout=f,stderr=subprocess.PIPE,check=True)
  listing=subprocess.run(pgcmd("pg_restore")+["--list",str(path)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout
  meta["databases"][name]={"bytes":path.stat().st_size,"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"archive_entries":len(listing.splitlines())}
 for p in ["chatwoot/.env","zca-bridge/app/.env"]:
  target=folder/(p.split("/")[0]+".env");target.write_bytes((OLD/p).read_bytes());target.chmod(0o600)
 (folder/"manifest.json").write_text(json.dumps(meta,indent=2));(ROOT/"checkpoints/latest-database-checkpoint.txt").write_text(str(folder)+"\n")
 print(json.dumps({"checkpoint":str(folder),**meta}),flush=True)
if __name__=="__main__":main()
