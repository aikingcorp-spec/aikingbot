#!/usr/bin/python3
"""Initialize only the AIKINGBOT-owned Zalo/Chatwoot stack; no OpenBot runtime dependency."""
from pathlib import Path
import os,socket,subprocess,time
ROOT=Path(__file__).resolve().parent
CW=ROOT/"runtime/chatwoot";ZCA=ROOT/"runtime/zca-bridge"
def alive(port):
 try:
  with socket.create_connection(("127.0.0.1",port),timeout=1):return True
 except OSError:return False
def dotenv(path):
 env={}
 for ln in path.read_text().splitlines():
  if "=" in ln and not ln.startswith("#"):
   k,v=ln.split("=",1);env[k.strip()]=v.strip().strip("\"'")
 return env
def detached(args,log,cwd=None,env=None):
 with open(log,"ab",buffering=0) as f:
  return subprocess.Popen(args,cwd=cwd,env={**os.environ,**(env or {})},stdin=subprocess.DEVNULL,stdout=f,stderr=f,start_new_session=True)
def pg(name):
 root=CW/"rootfs/pg"
 return [str(root/"lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"),"--library-path",str(root/"usr/lib/x86_64-linux-gnu")+":"+str(root/"lib/x86_64-linux-gnu"),str(root/"usr/lib/postgresql/18/bin"/name)]
def initialize():
 if "/aikingbot-zalo.service" not in Path("/proc/self/cgroup").read_text():raise RuntimeError("Initialize only through the dedicated systemd service")
 cwenv=dotenv(CW/".env")
 if not alive(6379):
  conf=CW/"redisdata/aiking-runtime.conf";conf.write_text('bind 127.0.0.1\nport 6379\ndir '+str(CW/"redisdata")+'\nrequirepass '+cwenv["REDIS_PASSWORD"]+'\ndaemonize yes\npidfile '+str(CW/"run/redis.pid")+'\nlogfile '+str(CW/"log/redis.log")+'\n')
  conf.chmod(0o600);r=CW/"rootfs/redis"
  subprocess.run([str(r/"lib/ld-musl-x86_64.so.1"),"--library-path",str(r/"lib")+":"+str(r/"usr/lib"),str(r/"usr/local/bin/redis-server"),str(conf)],check=True,capture_output=True)
 if not alive(54330):subprocess.run(pg("pg_ctl")+["-D",str(CW/"pgdata"),"-l",str(CW/"log/postgres.log"),"-w","start"],check=True,capture_output=True,timeout=30)
 if not alive(5432):subprocess.run([str(ZCA/"runtime/node_modules/@embedded-postgres/linux-x64/native/bin/pg_ctl"),"-D",str(ZCA/"runtime/pgdata"),"-l",str(ZCA/"runtime/pg.log"),"-w","start"],check=True,capture_output=True,timeout=30)
 if not alive(3010):
  (CW/"rootfs/chatwoot/app/tmp/pids/server.pid").unlink(missing_ok=True)
  detached(["aa-exec","-p","aikingbot-zalo","--","unshare","-m","-r",str(CW/"bin/enter.sh"),"bundle","exec","puma","-C","config/puma.rb"],CW/"log/rails.log")
 # Only this unit's process cgroup is consulted; unrelated Sidekiq is never used as a health signal.
 proc=subprocess.run(["systemctl","show","aikingbot-zalo.service","-p","ControlGroup","--value"],text=True,capture_output=True).stdout.strip()
 commands=[]
 if proc:
  try:
   for pid in Path("/sys/fs/cgroup"+proc+"/cgroup.procs").read_text().split():
    try:commands.append(Path("/proc/"+pid+"/cmdline").read_bytes().replace(b"\0",b" ").decode(errors="replace"))
    except OSError:pass
  except OSError:pass
 if not any("sidekiq 7" in c or "exec sidekiq" in c or "bin/sidekiq" in c for c in commands):
  detached(["aa-exec","-p","aikingbot-zalo","--","unshare","-m","-r",str(CW/"bin/enter.sh"),"bundle","exec","sidekiq","-C","config/sidekiq.yml"],CW/"log/sidekiq.log")
 if not alive(4000):detached(["/usr/bin/node","dist/main.js"],ZCA/"runtime/bridge.log",cwd=ZCA/"app",env=dotenv(ZCA/"app/.env"))
 for agent,port in [("lisa",3025),("aimie",3026)]:
  if not alive(port):detached(["/usr/bin/python3",str(ROOT/"bridge_service.py"),agent],CW/"log"/(agent+"-aikingbot.log"),cwd=ROOT)
if __name__=="__main__":
 import fcntl
 lock=open(ROOT/"state/stack.lock","a");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 while True:
  try:initialize();print("AIKINGBOT stack health pass",flush=True)
  except Exception as e:print("AIKINGBOT stack initialization error: "+type(e).__name__,flush=True)
  time.sleep(15)
