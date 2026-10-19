"""Use an existing authorized Owner browser session and official pairing; never edits auth stores."""
import json,os,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parent
state=json.loads(Path("/srv/aikingbot-staging/.secrets/browser-admin-state.json").read_text())
cookie="; ".join(c["name"]+"="+c["value"] for c in state["cookies"])
base="https://aikingbot-app.srv1866690.hstgr.cloud"
def call(path,body=None,token=None):
 headers={"content-type":"application/json","origin":base}
 headers.update({"authorization":"Bearer "+token} if token else {"cookie":cookie})
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
 with urllib.request.urlopen(req,timeout=30) as res:return json.load(res)
secrets=ROOT/"secrets";secrets.mkdir(exist_ok=True,mode=0o700)
for name in ["lisa","aimie"]:
 path=secrets/(name+".token")
 if not path.exists():
  pending=secrets/"pairing.json"
  opened=json.loads(pending.read_text()) if name=="lisa" and pending.exists() else call("/api/auth/pairing",{"label":"AIKINGBOT Zalo "+name+" service","scopes":["client"]})
  result=call("/api/auth/pair",{"code":opened["code"],"label":"AIKINGBOT Zalo "+name+" service"})
  path.write_text(result["token"]);path.chmod(0o600)
  if pending.exists():pending.unlink()
 result=call("/api/auth/session",token=path.read_text().strip())
 assert result["scopes"]==["client"],"Expected least-privilege paired service session"
 print("OFFICIAL_PAIRING_OK",name,"client only; no admin")
