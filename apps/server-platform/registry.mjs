// Copyright (c) 2026 AIKING.
import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { digest,newToken,fail,email } from "./common.mjs";
export class Registry {
  constructor(file) {
    this.db=new DatabaseSync(file);
    chmodSync(file,0o600);
    this.db.exec(`
      PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS bootstrap(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL,consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS servers(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_email TEXT NOT NULL,status TEXT NOT NULL,
        base_url TEXT,secret TEXT NOT NULL,managed INTEGER NOT NULL,created INTEGER NOT NULL,request_key TEXT UNIQUE,error TEXT);
      CREATE TABLE IF NOT EXISTS members(server_id TEXT NOT NULL,email TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('owner','member')),
        PRIMARY KEY(server_id,email), FOREIGN KEY(server_id) REFERENCES servers(id));
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at INTEGER NOT NULL,actor TEXT,server_id TEXT,action TEXT NOT NULL);
    `);
  }
  transaction(work) {this.db.exec("BEGIN IMMEDIATE");try{const value=work();this.db.exec("COMMIT");return value;}catch(error){this.db.exec("ROLLBACK");throw error;}}
  user(id,address) {
    const normalized=email(address);if(!normalized||typeof id!=="string"||!id||id.length>256)throw fail(401,"invalid_identity");
    const existing=this.db.prepare("SELECT * FROM users WHERE email=?").get(normalized);
    if(existing){if(existing.id!==id)throw fail(401,"identity_changed");return existing;}
    this.db.prepare("INSERT INTO users(id,email) VALUES(?,?)").run(id,normalized);return{id,email:normalized};
  }
  issue(user) {
    const token=newToken(),expires=Date.now()+30*86400_000;
    this.db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    if(this.db.prepare("SELECT count(*) n FROM sessions").get().n>=5000)throw fail(503,"session_limit");
    this.db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(digest(token),user.id,expires);
    return{token,expires};
  }
  authenticate(token) {
    if(typeof token!=="string"||token.length!==43)return null;
    const row=this.db.prepare("SELECT users.*,sessions.hash sessionHash,sessions.expires FROM sessions JOIN users ON users.id=sessions.user_id WHERE hash=? AND expires>?").get(digest(token),Date.now());
    return row||null;
  }
  bootstrap(token) {
    if(typeof token!=="string"||!token.startsWith("aka_")||token.length>100)return null;
    return this.transaction(()=>{
      const row=this.db.prepare("SELECT users.* FROM bootstrap JOIN users ON users.id=bootstrap.user_id WHERE hash=? AND expires>? AND consumed=0").get(digest(token),Date.now());
      if(!row)return null;
      this.db.prepare("UPDATE bootstrap SET consumed=1 WHERE hash=?").run(digest(token));
      return{user:row,...this.issue(row)};
    });
  }
  logout(user) {if(user?.sessionHash)this.db.prepare("DELETE FROM sessions WHERE hash=?").run(user.sessionHash);}
  server(id) {return this.db.prepare("SELECT * FROM servers WHERE id=?").get(id)||null;}
  role(id,address) {
    const rows=this.db.prepare("SELECT email,role FROM members WHERE server_id=?").all(id);
    return rows.find(row=>row.email===address)?.role||rows.find(row=>row.email==="@"+address.split("@")[1])?.role||null;
  }
  list(user) {
    return this.db.prepare("SELECT id,name,status,error,created FROM servers ORDER BY created,id").all()
      .flatMap(server=>{const role=this.role(server.id,user.email);return role?[{...server,role}]:[];});
  }
  requireMember(id,user,owner=false) {
    const server=this.server(id),role=this.role(id,user.email);
    if(!server||!role||(owner&&role!=="owner"))throw fail(403,"server_access_denied");
    return{server,role};
  }
  create(user,name,key) {
    const existing=this.db.prepare("SELECT * FROM servers WHERE request_key=?").get(user.id+":"+key);
    if(existing){if(existing.name!==name)throw fail(409,"idempotency_conflict");if(existing.status==="failed"){this.db.prepare("UPDATE servers SET status='provisioning',error=NULL WHERE id=?").run(existing.id);return this.server(existing.id);}return existing;}
    const now=Date.now();
    if(this.db.prepare("SELECT count(*) n FROM servers WHERE owner_email=? AND managed=1 AND created>?").get(user.email,now-60_000).n>=2)throw fail(429,"creation_rate_limit");
    const id=randomUUID();
    this.transaction(()=>{
      this.db.prepare("INSERT INTO servers VALUES(?,?,?,?,?,?,?,?,?,?)").run(id,name,user.email,"provisioning",null,newToken(),1,now,user.id+":"+key,null);
      this.db.prepare("INSERT INTO members VALUES(?,?,?)").run(id,user.email,"owner");
      this.audit(user.email,id,"create");
    });
    return this.server(id);
  }
  discard(id,actor) {
    this.transaction(()=>{
      this.db.prepare("DELETE FROM members WHERE server_id=?").run(id);
      this.db.prepare("DELETE FROM servers WHERE id=? AND status='failed' AND managed=1").run(id);
      this.audit(actor,id,"discard");
    });
  }
  ready(id,url) {this.db.prepare("UPDATE servers SET status='ready',base_url=?,error=NULL WHERE id=?").run(url,id);}
  failed(id,code) {this.db.prepare("UPDATE servers SET status='failed',error=? WHERE id=?").run(code,id);}
  pending() {return this.db.prepare("SELECT * FROM servers WHERE status='provisioning' ORDER BY created").all();}
  members(id) {return this.db.prepare("SELECT members.email,members.role,users.id userId FROM members LEFT JOIN users ON users.email=members.email WHERE server_id=? ORDER BY members.role,members.email").all(id);}
  setMembers(id,lists,actor) {
    const server=this.server(id);
    if(!lists.admins.includes(server.owner_email))throw fail(400,"creator_must_remain_owner");
    this.transaction(()=>{
      this.db.prepare("DELETE FROM members WHERE server_id=?").run(id);
      const add=this.db.prepare("INSERT INTO members VALUES(?,?,?)");
      for(const entry of lists.admins)add.run(id,entry,"owner");
      for(const entry of lists.members)if(!lists.admins.includes(entry))add.run(id,entry,"member");
      this.audit(actor,id,"membership");
    });
  }
  audit(actor,id,action) {
    this.db.prepare("INSERT INTO audit(at,actor,server_id,action) VALUES(?,?,?,?)").run(Date.now(),actor,id,action);
    this.db.exec("DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 2000)");
  }
  close(){this.db.close();}
}
