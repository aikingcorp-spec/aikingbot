"""Read-only live readiness checks; never prints secrets or treats HTTP acceptance as Agent completion."""
from pathlib import Path
import json,urllib.request,urllib.parse
from aikingbot_transport import AgentGateway
from db_status import query,dotenv,BASE
ROOT=Path(__file__).resolve().parent
def main():
 report={"service":"aikingbot-zalo.service","agents":{},"ports":{}}
 for name,port,path in [("chatwoot",3010,"/"),("zca",4000,"/healthz"),("lisa",3025,"/health"),("aimie",3026,"/health")]:
  try:
   with urllib.request.urlopen(f"http://127.0.0.1:{port}"+path,timeout=5) as f:report["ports"][name]=f.status==200
  except Exception:report["ports"][name]=False
 for name in ["lisa","aimie"]:
  try:report["agents"][name]=AgentGateway(ROOT/"secrets"/(name+".token")).preflight(name)
  except Exception as e:report["agents"][name]={"error":type(e).__name__}
 u=urllib.parse.urlsplit(dotenv(BASE/"zca-bridge/app/.env")["DATABASE_URL"])
 report["zalo"]=query("SELECT json_agg(json_build_object('id',id,'status',status)) FROM zalo_accounts",u.port or 5432,u.username,u.password,u.path.lstrip("/"))
 report["fully_ready"]=all(report["ports"].values()) and all(a["status"]=="connected" for a in report["zalo"]) and all("error" not in a for a in report["agents"].values())
 print(json.dumps(report,ensure_ascii=False,indent=2));return 0 if report["fully_ready"] else 2
if __name__=="__main__":raise SystemExit(main())
