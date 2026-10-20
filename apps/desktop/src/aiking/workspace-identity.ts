// Copyright (c) 2026 AIKING.
import { useEffect, useState } from "react";
import { at } from "./strings";

type Identity = { name: string; local: boolean };
let pending: Promise<Identity | null> | undefined;
function loadIdentity(): Promise<Identity | null> {
  pending ??= (async () => {
    if (window.ogb?.workspaces) {
      try { const state = await window.ogb.workspaces.state(); return {name:state.name,local:state.local}; }
      catch { return null; }
    }
    try {
      const response = await fetch("/.well-known/aikingbot/environment", {cache:"no-store"});
      if (!response.ok) return null;
      const value: unknown = await response.json();
      const label = Reflect.get(Object(value),"label");
      return typeof label === "string" && label.trim() ? {name:label.slice(0,160),local:false} : null;
    } catch { return null; }
  })();
  return pending;
}
export function useWorkspaceIdentity() {
  const [identity,setIdentity]=useState<Identity|null>(null);
  useEffect(()=>{
    let live=true;void loadIdentity().then(value=>{if(live)setIdentity(value);});
    return ()=>{live=false;};
  },[]);
  if(!identity)return {name:at("workspace.current"),local:false};
  // The desktop main process names the built-in Server "This computer" in English; show it in the person's language.
  return identity.local&&identity.name==="This computer"?{...identity,name:at("rail.local")}:identity;
}
export function openWorkspacePanel(): void { window.dispatchEvent(new Event("aiking:servers-changed")); window.dispatchEvent(new Event("aiking:workspaces")); }
