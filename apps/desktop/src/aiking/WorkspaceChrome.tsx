// Copyright (c) 2026 AIKING. Window chrome for the AIKINGBOT stage 2 shell:
// the 72px workspace rail, the workspace title, the marketplace button and
// the rounded corner where the content sheet meets the chrome.
import { useEffect, useRef, useState } from "react";
import { WorkspacePanel } from "./WorkspacePanel";
import { selectServer, useServerDirectory } from "./server-directory";
import { discardFailedServer } from "./platform-api";
import { openWorkspacePanel, useWorkspaceIdentity } from "./workspace-identity";
import { Blocks, ChevronsUpDown, LogOut, Plus } from "lucide-react";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { useCaptionChrome, useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { openMarketplace } from "./marketplace-state";
import { at } from "./strings";

/** The AIKING workspace mark: a mint-to-teal orb, like the reference's server gradient. */
export function WorkspaceOrb({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 32% 28%, #e8fff6 0 8%, #6ee7c0 28%, #13a374 62%, #0b3d2e 100%)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
      }}
    />
  );
}

/** App identity in the existing workspace tile; the surface supplies its one mask. */
function WorkspaceTile() {
  return <img aria-hidden="true" alt="" src="/app-icon-192.png" width={40} height={40} className="relative block size-10 rounded-xl" />;
}

export function WorkspaceTitle({ cloudHome }: { cloudHome: boolean }) {
  const identity=useWorkspaceIdentity();
  return (
    <button type="button" onClick={openWorkspacePanel} data-workspace-title className="flex min-w-0 items-center gap-2 px-1 text-[14px] font-semibold text-ink">
      <WorkspaceOrb />
      <span className="min-w-0 truncate">{cloudHome ? t("cloudSetup.myCloud") : identity.name}</span>
      <ChevronsUpDown size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </button>
  );
}

export function MarketplaceButton() {
  const ownerOrAdmin=useOwnerOrAdmin();
  if(ownerOrAdmin!==true)return null;
  return (
    <button
      type="button"
      onClick={() => openMarketplace("agents")}
      aria-label={at("sidebar.marketplace")}
      title={at("sidebar.marketplace")}
      className="flex size-8 items-center justify-center rounded-md text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <Blocks size={17} strokeWidth={1.8} />
    </button>
  );
}

/** Paints the chrome into the top-left corner of the content sheet, so the sheet reads as rounded. */
export function SheetCorner() {
  return (
    <span
      aria-hidden="true"
      data-sheet-corner
      className="pointer-events-none absolute left-0 top-10 z-20 hidden size-3 md:block"
      style={{ background: "radial-gradient(circle at 100% 100%, transparent 11.5px, var(--color-chrome) 12px)" }}
    />
  );
}

/** The left rail: this computer's workspace, then a button to connect another one. */
export function WorkspaceRail() {
  const { dispatch } = useStore();
  const identity=useWorkspaceIdentity();
  const [open,setOpen]=useState(false);
  const {directory,error:directoryError}=useServerDirectory();
  const [switching,setSwitching]=useState(false);
  const [switchError,setSwitchError]=useState("");
  const [menu,setMenu]=useState<{id:string;name:string;x:number;y:number;status?:string}|null>(null);
  const changing=useRef(false);
  const live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const entries=directory?.servers.length?directory.servers:[{id:"current",name:identity.name,local:identity.local,missing:false}];
  const activeId=directory?.servers.length?directory.activeId:"current";
  const openServer=async(id:string)=>{
    if(changing.current)return;
    if(id===activeId){dispatch({type:"showChat"});return;}
    changing.current=true;setSwitching(true);setSwitchError("");
    try{await selectServer(id);}
    catch(cause){if(live.current)setSwitchError(cause instanceof Error?cause.message:at("workspace.switchFailed"));}
    finally{changing.current=false;if(live.current)setSwitching(false);}
  };
  const discardServer=async(id:string)=>{
    if(!window.confirm(at("server.discardConfirm")))return;
    try{await discardFailedServer(id);}catch(cause){setSwitchError(cause instanceof Error?cause.message:at("workspace.switchFailed"));}
  };
  useEffect(()=>{
    if(!menu)return;
    const close=()=>setMenu(null);
    const key=(event:KeyboardEvent)=>{if(event.key==="Escape")close();};
    window.addEventListener("click",close);window.addEventListener("blur",close);window.addEventListener("keydown",key);
    return()=>{window.removeEventListener("click",close);window.removeEventListener("blur",close);window.removeEventListener("keydown",key);};
  },[menu]);
  const removeServer=async(id:string,name:string,purge:boolean)=>{
    if(!window.confirm(at(purge?"server.removeDataConfirm":"server.removeConfirm",{name})))return;
    try{
      const result=await window.ogb?.environments?.forget(id,purge);
      if(result&&result.ok===false)throw new Error(at(result.error==="active"?"server.removeActive":"server.removeFailed"));
      window.dispatchEvent(new Event("aiking:servers-changed"));
    }catch(cause){setSwitchError(cause instanceof Error?cause.message:at("server.removeFailed"));}
  };
  useEffect(()=>{const show=()=>setOpen(true);window.addEventListener("aiking:workspaces",show);return()=>window.removeEventListener("aiking:workspaces",show);},[]);
  const { capabilities } = useDesktopCapabilities();
  const chrome = useCaptionChrome();
  const browser = capabilities.host.label === "Browser";
  const macInset = capabilities.windowChrome === "mac-inset";
  return (
    <nav
      aria-label={at("rail.label")}
      data-workspace-rail
      className="relative hidden w-[72px] shrink-0 flex-col items-center bg-[var(--color-chrome)] md:flex"
    >
      <div className="flex h-10 w-full shrink-0 items-center justify-center gap-1.5" {...chrome.dragProps}>
        {browser && !macInset && (
          <>
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </>
        )}
      </div>
      <div className="flex min-h-0 w-full flex-col items-center gap-3.5 overflow-y-auto pb-4 pt-1.5">
        {entries.map(entry=><div key={entry.id} className="relative flex w-full justify-center">
          {entry.id===activeId&&<span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-ink"/>}
          <button type="button" data-server-tile={entry.id} aria-current={entry.id===activeId?"page":undefined}
            aria-label={entry.id==="local"?at("rail.local"):entry.name} title={(entry.id==="local"?at("rail.local"):entry.name)+" · "+at(entry.status==="provisioning"?"server.provisioning":entry.status==="failed"?"server.provisionFailed":entry.missing?"server.missing":entry.id===activeId?"server.connected":"server.saved")}
            onContextMenu={event=>{event.preventDefault();setMenu({id:entry.id,name:entry.name,x:event.clientX,y:event.clientY,status:entry.status});}}
            disabled={switching||(entry.missing&&entry.status!=="failed")||Boolean(entry.status&&entry.status!=="ready"&&entry.status!=="failed")} onClick={()=>entry.status==="failed"?void discardServer(entry.id):void openServer(entry.id)}
            className="relative shrink-0 rounded-xl outline-none transition-transform duration-150 hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-40">
            {entry.id==="local"||entry.id==="current"?<WorkspaceTile/>:<span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-raised text-[14px] font-semibold text-ink">{entry.name.slice(0,2).toLocaleUpperCase()}</span>}
            <span aria-hidden="true" className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--color-chrome)]",entry.id===activeId?"bg-success":"bg-ink-tertiary")}/>
          </button>
        </div>)}
        <button
          type="button"
          data-server-add
          aria-label={at("rail.add")}
          title={at("rail.add")}
          onClick={openWorkspacePanel}
          className="flex size-10 items-center justify-center rounded-xl bg-raised text-ink-secondary transition-colors hover:bg-raised-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Plus size={18} />
        </button>
      </div>
      {(switchError||directoryError)&&<button type="button" data-server-error role="status" title={switchError||at("server.loadFailed")} aria-label={switchError||at("server.loadFailed")} className="mt-2 rounded px-2 text-[11px] text-danger" onClick={openWorkspacePanel}>!</button>}
      {menu&&<ServerMenu menu={menu} activeId={activeId} onOpen={id=>void openServer(id)} onRemove={removeServer} onDiscard={id=>void discardServer(id)}/>}
      {browser && <BrowserSignOut />}
      {open && <WorkspacePanel directory={directory} onClose={()=>setOpen(false)}/>}
    </nav>
  );
}

/** Right-click on a server tile: open, turn off (back to this computer), or remove it. The main server of this computer has nothing to remove. */
function ServerMenu({menu,activeId,onOpen,onRemove,onDiscard}:{menu:{id:string;name:string;x:number;y:number;status?:string};activeId:string;onOpen:(id:string)=>void;onRemove:(id:string,name:string,purge:boolean)=>Promise<void>;onDiscard:(id:string)=>void}) {
  const main=menu.id==="local"||menu.id==="current";
  const active=menu.id===activeId;
  const item="block w-full rounded-md px-3 py-1.5 text-left text-[13px] text-ink hover:bg-raised-hover";
  return (
    <div role="menu" data-server-menu style={{left:Math.min(menu.x,window.innerWidth-260),top:Math.min(menu.y,window.innerHeight-170)}} className="fixed z-50 w-[250px] rounded-lg border border-line bg-raised p-1 shadow-lg" onClick={event=>event.stopPropagation()}>
      <div className="truncate px-3 py-1 text-[12px] font-semibold text-ink-secondary">{main?at("rail.local"):menu.name}</div>
      {main?<p className="px-3 py-1.5 text-[12px] leading-snug text-ink-secondary">{at("server.menu.thisComputer")}</p>:<>
        {menu.status==="failed"?<button role="menuitem" type="button" className={item} onClick={()=>onDiscard(menu.id)}>{at("server.menu.remove")}</button>:<>
          {active?<button role="menuitem" type="button" data-server-off className={item} onClick={()=>onOpen("local")}>{at("server.menu.off")}</button>
            :<button role="menuitem" type="button" className={item} onClick={()=>onOpen(menu.id)}>{at("server.menu.open")}</button>}
          <button role="menuitem" type="button" data-server-remove className={item} onClick={()=>void onRemove(menu.id,menu.name,false)}>{at("server.menu.remove")}</button>
          <button role="menuitem" type="button" className={item+" text-danger"} onClick={()=>void onRemove(menu.id,menu.name,true)}>{at("server.menu.removeData")}</button>
        </>}
      </>}
    </div>
  );
}

/** A browser signed in to a hosted workspace can always sign out: the server ends this browser's workspace and account sessions. */
function BrowserSignOut() {
  return (
    <button
      type="button"
      data-browser-signout
      aria-label={at("account.signOut")}
      title={at("account.signOut")}
      onClick={() => {
        void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" })
          .catch(() => undefined)
          .finally(() => location.replace("/pair"));
      }}
      className="mb-4 mt-auto flex size-10 items-center justify-center rounded-xl text-ink-secondary transition-colors hover:bg-raised-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <LogOut size={17} />
    </button>
  );
}
