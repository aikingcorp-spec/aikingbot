"""Compare original logical snapshot to current customer history/identity/blob rows; no content is printed."""
from pathlib import Path
from backup_databases import ROOT,OLD,pgcmd,dotenv
import os,subprocess,json,time
cfg=dotenv(OLD/"chatwoot/.env");args=["-h","127.0.0.1","-p",cfg["POSTGRES_PORT"],"-U",cfg["POSTGRES_USERNAME"]];env={**os.environ,"PGPASSWORD":cfg["POSTGRES_PASSWORD"]}
name="aiking_preservation_fixture_"+str(os.getpid())
def sql(text,db):
 out=subprocess.run(pgcmd("psql")+args+["-d",db,"-t","-A","-v","ON_ERROR_STOP=1","-c",text],env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout.decode().strip()
 return out
report={}
try:
 sql("CREATE DATABASE "+name,"postgres")
 original=ROOT/"checkpoints/db-20261019T090657Z/chatwoot.dump"
 subprocess.run(pgcmd("pg_restore")+args+["-d",name,"--no-owner","--no-acl","--exit-on-error",str(original)],env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 prod=cfg["POSTGRES_DATABASE"]
 for table,fields in [("messages","id,conversation_id,inbox_id,message_type,content,private,sender_type,sender_id"),("contacts","id,account_id,identifier,email,phone_number"),("active_storage_blobs","id,key,checksum,byte_size")]:
  maxid=int(sql("SELECT COALESCE(max(id),0) FROM "+table,name))
  expr="SELECT json_build_object('count',count(*),'digest',md5(string_agg(row_to_json(x)::text,'' ORDER BY id))) FROM (SELECT "+fields+" FROM "+table+" WHERE id<="+str(maxid)+")x"
  before=json.loads(sql(expr,name));after=json.loads(sql(expr,prod));report[table]={"max_original_id":maxid,"original_rows":before["count"],"rows_and_hash_unchanged":before==after};assert before==after,table+" changed"
 blobs=json.loads(sql("SELECT COALESCE(json_agg(key),'[]'::json) FROM active_storage_blobs",name))
 storage=OLD/"chatwoot/rootfs/chatwoot/app/storage";missing=[k for k in blobs if not (storage/k[:2]/k[2:4]/k).exists()]
 report["original_blob_files"]={"total":len(blobs),"missing":len(missing)};assert not missing
 report["ok"]=True
except Exception as e:report["ok"]=False;report["error"]=type(e).__name__+":"+str(e)[:500]
finally:
 sql("DROP DATABASE "+name+" WITH(FORCE)","postgres")
 report["fixture_cleaned"]=True;(ROOT/"evidence/data-preservation.json").write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
