// Copyright (c) 2026 AIKING.
import { useCallback, useEffect, useState } from "react";
import { at } from "./strings";
import { managedServersEnabled,platformRequest } from "./platform-api";

export type ServerEntry = { id: string; name: string; local: boolean; missing: boolean; status?:string; role?:"owner"|"member"; url?:string };
export type ServerDirectory = { activeId: string; canCreate: boolean; servers: ServerEntry[]; provider?:"managed" };
export function useServerDirectory() {
  const [directory, setDirectory] = useState<ServerDirectory | null>(null);
  const [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    if(managedServersEnabled())return platformRequest<ServerDirectory>("servers"+(/^\/servers\/([a-f0-9-]{36})/.exec(location.pathname)?.[1]?"?active="+encodeURIComponent(/^\/servers\/([a-f0-9-]{36})/.exec(location.pathname)![1]):""));
    const bridge = window.ogb;
    if (bridge?.workspaces?.servers) return bridge.workspaces.servers();
    if (bridge?.environments) {
      const saved = await bridge.environments.state();
      return { activeId: saved.activeId, canCreate: saved.packaged && !saved.remote, servers: [
        { id: "local", name: at("rail.local"), local: true, missing: false },
        ...saved.environments.map(entry => ({id:entry.id,name:entry.name,local:entry.kind==="local",missing:entry.missing===true})),
      ] };
    }
    return null;
  }, []);
  useEffect(() => {
    let live = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try { const next = await refresh(); if (live) { setDirectory(next); setError(false); } }
      catch { if (live) setError(true); }
      finally { pending = false; }
    };
    void load();
    const timer=managedServersEnabled()?setInterval(()=>{if(document.visibilityState==="visible")void load();},30_000):null;
    window.addEventListener("focus", load);
    window.addEventListener("aiking:servers-changed", load);
    return () => { live=false; if(timer)clearInterval(timer); window.removeEventListener("focus",load); window.removeEventListener("aiking:servers-changed",load); };
  }, [refresh]);
  return { directory, error };
}
export async function selectServer(id: string): Promise<boolean> {
  if(managedServersEnabled()){
    const result=await platformRequest<{server:{status:string;url:string}}>("servers/"+encodeURIComponent(id));
    if(result.server.status!=="ready")throw new Error(at("server.stillProvisioning"));
    location.assign(result.server.url);return true;
  }
  if (window.ogb?.workspaces?.select) {
    const result = await window.ogb.workspaces.select(id);
    if (result.error === "cancelled") return false;
    if (!result.ok) throw new Error(at("workspace.switchFailed"));
    return true;
  }
  const bridge = window.ogb?.environments;
  if (!bridge) throw new Error(at("workspace.switchFailed"));
  const state = await bridge.state();
  const local = id === "local" || state.environments.find(entry=>entry.id===id)?.kind==="local";
  if (local && !await window.ogb!.confirm(at("server.switchWarning"))) return false;
  const result = await bridge.switch(id);
  if (result?.ok === false) throw new Error(at("workspace.switchFailed"));
  return true;
}
