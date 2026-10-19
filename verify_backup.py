"""Restore into owned temporary databases on PostgreSQL with the same installed extensions."""
from pathlib import Path
import os,subprocess,json,time,shutil
from backup_databases import ROOT,OLD,pgcmd,dotenv
os.umask(0o077);cfg=dotenv(OLD/"chatwoot/.env")
env={**os.environ,"PGPASSWORD":cfg["POSTGRES_PASSWORD"]}
args=["-h","127.0.0.1","-p",cfg["POSTGRES_PORT"],"-U",cfg["POSTGRES_USERNAME"]]
def sql(text,database="postgres"):
 return subprocess.run(pgcmd("psql")+args+["-d",database,"-v","ON_ERROR_STOP=1","-t","-A","-c",text],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.decode().strip()
report={"production_restored":False,"isolated_databases_only":True,"checks":{}}
owned=[]
try:
 checkpoint=Path((ROOT/"checkpoints/latest-database-checkpoint.txt").read_text().strip())
 for name in ["chatwoot","zca"]:
  target="aiking_migration_restore_"+str(int(time.time()))+"_"+name;sql("CREATE DATABASE "+target);owned.append(target)
  result=subprocess.run(pgcmd("pg_restore")+args+["-d",target,"--no-owner","--no-acl","--single-transaction","--exit-on-error",str(checkpoint/(name+".dump"))],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  if result.returncode:raise RuntimeError(name+" restore failed: "+result.stderr.decode()[-1000:])
  tables=int(sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'",target))
  assert tables>0;report["checks"][name]={"restored":True,"public_tables":tables}
 report["ok"]=True
except Exception as e:report["ok"]=False;report["error"]=str(e)[:1200]
finally:
 for target in owned:sql("DROP DATABASE "+target+" WITH (FORCE)")
 report["cleaned"]=True
 fixture=ROOT/"evidence/restore-fixture"
 if fixture.exists() and not (fixture/"data/postmaster.pid").exists():shutil.rmtree(fixture)
 (ROOT/"evidence/backup-restore.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
