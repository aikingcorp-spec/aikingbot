// Copyright (c) 2026 AIKING.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronRight, Loader2, Plus, RefreshCw, Settings, Users, X } from "lucide-react";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { useStore } from "@/state/store";
import { readSessionState, isOwnerOrAdmin } from "@/lib/session";
import { setAdvancedMode } from "@/lib/interface-mode";
import { readAccountState, type AccountState } from "./account/account-api";
import { useWorkspaceIdentity } from "./workspace-identity";
import { workspaceJoinURL } from "./workspace-link";
import { selectServer, type ServerDirectory } from "./server-directory";
import { at, type AikingKey } from "./strings";
import { createManagedServer } from "./platform-api";

type EnvironmentBridge = NonNullable<NonNullable<Window["ogb"]>["environments"]>;
type Saved = Awaited<ReturnType<EnvironmentBridge["state"]>>;
const button = "rounded-lg border border-hairline/50 px-3 py-2 text-[13px] hover:bg-raised disabled:opacity-50";
const field = "w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-focus";

export function WorkspacePanel({onClose,directory}:{onClose:()=>void;directory?:ServerDirectory|null}) {
  const {dispatch}=useStore();
  const identity=useWorkspaceIdentity();
  const ref=useRef<HTMLDivElement>(null);
  const pending=useRef(false);
  const live=useRef(true);
  const [page,setPage]=useState<"home"|"create"|"join"|"advanced">("home");
  const [name,setName]=useState("");
  const [address,setAddress]=useState("");
  const [saved,setSaved]=useState<Saved|null>(null);
  const [account,setAccount]=useState<AccountState|null>(null);
  const [owner,setOwner]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [provisionStatus,setProvisionStatus]=useState("");
  const createKey=useRef<string|null>(null);
  const close=()=>{if(!pending.current)onClose();};
  useModalDialog(ref,close);
  useEffect(()=>{
    live.current=true;
    void readAccountState().then(value=>{if(live.current)setAccount(value);});
    void readSessionState().then(value=>{if(live.current)setOwner(value.kind==="session"||value.kind==="loopback"?isOwnerOrAdmin(value):null);});
    void window.ogb?.environments?.state().then(value=>{if(live.current)setSaved(value);}).catch(()=>{});
    return ()=>{live.current=false;};
  },[]);
  const canCreate=Boolean(directory?.canCreate || (saved?.packaged && !saved.remote));
  const canConnect=Boolean(saved && !saved.remote && window.ogb?.environments);
  const nativeChooser=Boolean(window.ogb?.workspaces);
  const run=async(work:()=>Promise<void>)=>{
    if(pending.current)return;
    pending.current=true;setBusy(true);setError("");
    try{await work();}
    catch(cause){if(live.current)setError(cause instanceof Error?cause.message:at("workspace.failed"));}
    finally{pending.current=false;if(live.current)setBusy(false);}
  };
  const openSettings=(members=false)=>{
    if(!members && nativeChooser && !canConnect) {
      void run(async()=>{await window.ogb!.workspaces!.menu();}); return;
    }
    onClose();setAdvancedMode(true);
    dispatch({type:"toggleAppSettings",open:true,section:members?"people":canConnect?"desktopWorkspaces":"general"});
  };
  const createFailure=(code?:string)=>{
    const known=["name","duplicate","nested","path","dev","busy"];
    return at(known.includes(code??"")?("workspace.createFailed."+code) as AikingKey:"workspace.createFailed");
  };
  const create=()=>run(async()=>{
    if(!canCreate || !name.trim())return;
    if(directory?.provider==="managed"){
      createKey.current??=crypto.randomUUID();
      await createManagedServer(name.trim(),createKey.current,value=>{if(live.current)setProvisionStatus(value);});
    } else if(window.ogb?.workspaces?.create) {
      const result=await window.ogb.workspaces.create(name.trim());
      if(result.error==="cancelled")return;
      if(!result.ok)throw new Error(createFailure(result.error));
    } else {
      const bridge=window.ogb?.environments;
      if(!bridge)throw new Error(at("workspace.createFailed"));
      const result=await bridge.create(name.trim());
      if(!result.ok)throw new Error(createFailure(result.error));
      const next=await bridge.state();
      const known=new Set(saved?.environments.map(entry=>entry.id));
      const entry=next.environments.find(entry=>entry.kind==="local"&&!known.has(entry.id));
      window.dispatchEvent(new Event("aiking:servers-changed"));
      if(!entry)throw new Error(at("workspace.createFailed"));
      if(!await selectServer(entry.id))return;
    }
    window.dispatchEvent(new Event("aiking:servers-changed"));
  });
  const join=()=>run(async()=>{
    const url=workspaceJoinURL(address);
    if(!url)throw new Error(at("workspace.invalidLink"));
    if(directory?.provider==="managed"&&new URL(url).origin===location.origin&&new URL(url).pathname.startsWith("/servers/"))window.location.assign(url);
    else if(window.ogb?.workspaces?.connect) {
      const result=await window.ogb.workspaces.connect(url);
      if(result.error==="cancelled")return;
      if(!result.ok)return;
    } else if(canConnect) {
      if(await window.ogb!.environments!.addFromLink(url)===false)return;
    } else if(nativeChooser) {
      await window.ogb!.workspaces!.menu();return;
    } else window.location.assign(url);
    window.dispatchEvent(new Event("aiking:servers-changed"));
  });
  const title=page==="create"?"workspace.create":page==="join"?"workspace.join":page==="advanced"?"server.advanced":"workspace.title";
  return createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={event=>{if(event.target===event.currentTarget)close();}}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="workspace-panel-title" data-workspace-panel data-server-panel className="max-h-[90vh] w-full max-w-[500px] overflow-auto rounded-2xl border border-hairline/50 bg-panel p-5 text-ink shadow-2xl outline-none">
      <div className="mb-4 flex items-center gap-2">
        {page!=="home"&&<button type="button" className={button} disabled={busy} aria-label={at("workspace.back")} onClick={()=>{setPage("home");setError("");}}><ArrowLeft size={15}/></button>}
        <h2 id="workspace-panel-title" className="flex-1 text-[17px] font-semibold">{at(title)}</h2>
        <button type="button" className={button} disabled={busy} aria-label={at("workspace.close")} onClick={close}><X size={16}/></button>
      </div>
      {error&&<p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
      {page==="home"?<>
        <div className="mb-4 rounded-xl bg-raised p-3">
          <div className="flex items-center gap-2"><Check size={15} className="text-success"/><span className="min-w-0 flex-1 truncate text-[14px] font-medium" data-current-workspace>{identity.name}</span><button type="button" className={button} aria-label={at("workspace.reconnect")} onClick={()=>window.location.reload()}><RefreshCw size={14}/></button></div>
          <p className="mt-1 text-[12px] text-ink-secondary">{owner===null?"":owner?at("account.owner"):at("account.member")}{account?.account.email?" · "+account.account.email:""}</p>
        </div>
        <div className="grid gap-2">
          <button type="button" data-workspace-join className={button+" flex items-center gap-3 py-3 text-left"} onClick={()=>setPage("join")}><Users size={19}/><span className="flex-1"><strong className="block font-medium">{at("workspace.join")}</strong><span className="mt-1 block text-[12px] text-ink-secondary">{at("server.joinSummary")}</span></span><ChevronRight size={15}/></button>
          <button type="button" data-workspace-create data-available={canCreate} className={button+" flex items-center gap-3 py-3 text-left"} onClick={()=>setPage("create")}><Plus size={19}/><span className="flex-1"><strong className="block font-medium">{at("workspace.create")}</strong><span className="mt-1 block text-[12px] text-ink-secondary">{at(canCreate?"server.createSummary":directory?.provider==="managed"?"server.creationDenied":"server.desktopOnly")}</span></span><ChevronRight size={15}/></button>
          <button type="button" data-workspace-advanced className={button+" flex items-center gap-3 py-3 text-left"} onClick={()=>setPage("advanced")}><Settings size={19}/><span className="flex-1"><strong className="block font-medium">{at("server.advanced")}</strong><span className="mt-1 block text-[12px] text-ink-secondary">{at("server.advancedSummary")}</span></span><ChevronRight size={15}/></button>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-secondary">{at("server.workspaceHint")}</p>
        {owner&&<button type="button" data-server-members className={button+" mt-3"} onClick={()=>openSettings(true)}>{at("server.members")}</button>}
      </>:page==="create"&&!canCreate?<div data-server-unavailable className="space-y-3 rounded-xl bg-raised p-4 text-[13px] leading-relaxed">
        <p>{at(directory?.provider==="managed"?"server.creationDenied":"server.desktopOnly")}</p>{directory?.provider!=="managed"&&<p className="text-ink-secondary">{at("server.cloudUnavailable")}</p>}
        {nativeChooser&&<button type="button" className={button} onClick={()=>void run(async()=>{await window.ogb!.workspaces!.menu();})}>{at("server.nativeChooser")}</button>}
      </div>:<form onSubmit={event=>{event.preventDefault();void(page==="create"?create():join());}} className="space-y-3">
        <label className="block text-[13px]">{at(page==="create"?"workspace.name":"workspace.address")}
          <input autoFocus required maxLength={page==="create"?60:2048} data-workspace-input className={field+" mt-1"} value={page==="create"?name:address} onChange={event=>{if(page==="create"){setName(event.target.value);createKey.current=null;}else setAddress(event.target.value);}} placeholder={page==="create"?"":page==="join"?"https://server.example.com/pair":"https://server.example.com"} disabled={busy} autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false}/>
        </label>
        <p className="text-[12.5px] leading-relaxed text-ink-secondary">{at(page==="create"?(directory?.provider==="managed"?"server.managedHint":"workspace.createHint"):page==="join"?"workspace.joinHint":"server.advancedHint")}</p>
        {page==="join"&&<div className="rounded-lg bg-raised p-3 text-[12px] leading-relaxed text-ink-secondary">
          <p>{at("server.qrHint")}</p>
          {account&&<p className="mt-2" data-server-account>{at("server.signedIn",{email:account.account.email})} · {at("server.accountScope")}</p>}
        </div>}
        {provisionStatus&&<p role="status" data-server-provision-status className="text-[13px] text-ink-secondary">{at("server.provisioning")}</p>}
        <button type="submit" className={button+" flex items-center gap-2 bg-accent text-accent-ink"} disabled={busy || (page==="create"?!name.trim():!workspaceJoinURL(address))}>{busy&&<Loader2 size={14} className="animate-spin"/>}{at(page==="create"?"workspace.createOpen":"workspace.continue")}</button>
        {page==="advanced"&&<button type="button" data-server-full-settings className={button+" flex items-center gap-2"} disabled={busy} onClick={()=>openSettings()}><Settings size={14}/>{at("server.fullSettings")}</button>}
      </form>}
    </div>
  </div>,document.body);
}
