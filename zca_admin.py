"""Official ZCA admin login using its existing app-owned credential, no auth-store edits."""
from pathlib import Path
import urllib.request,http.cookiejar,json
ROOT=Path(__file__).resolve().parent
def admin():
 lines=[s.strip() for s in (ROOT/"runtime/zca-bridge/runtime/admin-login.txt").read_text().splitlines() if s.strip()]
 lines=[s.split("=",1)[1] if "=" in s else s for s in lines]
 jar=http.cookiejar.MozillaCookieJar(str(ROOT/"secrets/zca-admin.cookies"))
 client=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
 req=urllib.request.Request("http://127.0.0.1:4000/admin/api/login",data=json.dumps({"username":lines[0],"password":lines[1]}).encode(),headers={"content-type":"application/json"})
 with client.open(req,timeout=15) as f:assert json.load(f).get("ok")
 jar.save(ignore_discard=True,ignore_expires=True);Path(jar.filename).chmod(0o600)
 return client
if __name__=="__main__":
 c=admin()
 with c.open("http://127.0.0.1:4000/admin/api/accounts",timeout=10) as f:
  d=json.load(f);print("OFFICIAL_ZCA_ADMIN_AUTH_OK",len(d) if isinstance(d,list) else list(d))
