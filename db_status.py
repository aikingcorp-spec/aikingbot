"""Read-only business/session counts; never prints customer text or credentials."""
from pathlib import Path
import json,os,subprocess,urllib.parse
ROOT=Path(__file__).resolve().parent
OLD=Path("/var/lib/openbot/OpenBot/Shared/AIKING")
BASE=OLD if (OLD/"chatwoot").exists() else ROOT/"runtime"
def dotenv(path):
 out={}
 for ln in path.read_text().splitlines():
  if "=" in ln and not ln.startswith("#"):
   k,v=ln.split("=",1);out[k]=v.strip().strip("\"'")
 return out
def query(sql,port,user,password,database):
 root=BASE/"chatwoot/rootfs/pg"
 cmd=[str(root/"lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"),"--library-path",str(root/"usr/lib/x86_64-linux-gnu")+":"+str(root/"lib/x86_64-linux-gnu"),str(root/"usr/lib/postgresql/18/bin/psql"),"-h","127.0.0.1","-p",str(port),"-U",user,"-d",database,"-t","-A","-v","ON_ERROR_STOP=1","-c",sql]
 r=subprocess.run(cmd,env={**os.environ,"PGPASSWORD":password},stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
 return json.loads(r.stdout.decode().strip())
def status():
 cw=dotenv(BASE/"chatwoot/.env");zca=urllib.parse.urlsplit(dotenv(BASE/"zca-bridge/app/.env")["DATABASE_URL"])
 cwargs=(cw["POSTGRES_PORT"],cw["POSTGRES_USERNAME"],cw["POSTGRES_PASSWORD"],cw["POSTGRES_DATABASE"]);zargs=(zca.port or 5432,zca.username,zca.password,zca.path.lstrip("/"))
 result={}
 result["chatwoot"]=query("SELECT json_build_object('contacts',(SELECT count(*) FROM contacts),'conversations',(SELECT count(*) FROM conversations),'messages',(SELECT count(*) FROM messages),'inboxes',(SELECT count(*) FROM inboxes))",*cwargs)
 result["zca"]=query("SELECT json_build_object('accounts',(SELECT count(*) FROM zalo_accounts),'sessions',(SELECT count(*) FROM zalo_sessions),'credential_fingerprint',(SELECT md5(string_agg(encrypted_credentials,'' ORDER BY zalo_account_id)) FROM zalo_sessions),'queue',(SELECT json_object_agg(status,n) FROM (SELECT status,count(*) n FROM job_queue GROUP BY status)x))",*zargs)
 result["legacy_unfinished"]=query("""SELECT coalesce(json_agg(x),'[]'::json) FROM (
 SELECT c.display_id conversation,e.key message,e.value->>'status' status
 FROM conversations c CROSS JOIN LATERAL jsonb_each(coalesce(c.custom_attributes::jsonb->CASE WHEN c.inbox_id=1 THEN 'lisa_openbot_bridge' ELSE 'aimie_openbot_bridge' END,'{}'::jsonb)) e
 WHERE c.inbox_id IN (1,2) AND e.value->>'status' IN ('dispatching','queued','sending','dispatch_uncertain','send_uncertain')
 )x""",*cwargs)
 return result
if __name__=="__main__":print(json.dumps(status(),indent=2))
