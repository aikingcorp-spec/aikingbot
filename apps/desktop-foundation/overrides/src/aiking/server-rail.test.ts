// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceRail } from "./WorkspaceChrome";
import { setLocale } from "@/lib/i18n";
const mocks=vi.hoisted(()=>({dispatch:vi.fn()}));
vi.mock("@/state/store",()=>({useStore:()=>({dispatch:mocks.dispatch})}));
vi.mock("@/lib/use-owner-or-admin",()=>({useOwnerOrAdmin:()=>true}));
vi.mock("@/components/DesktopCapabilities",()=>({
 useDesktopCapabilities:()=>({capabilities:{host:{label:"Browser"},windowChrome:"native"}}),
 useCaptionChrome:()=>({dragProps:{}}),
}));
vi.mock("./workspace-identity",()=>({
 useWorkspaceIdentity:()=>({name:"Team A",local:false}),
 openWorkspacePanel:()=>window.dispatchEvent(new Event("aiking:workspaces")),
}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{
 vi.clearAllMocks();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("ogb",undefined);setLocale("en");
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=()=>act(async()=>root.render(createElement(WorkspaceRail)));
const directory=(activeId="a")=>({activeId,canCreate:true,servers:[
 {id:"a",name:"Team A",local:false,missing:false},{id:"b",name:"Team B",local:true,missing:false},
 {id:"gone",name:"Missing",local:true,missing:true},
]});
it("renders the native saved directory with current, saved and unavailable states",async()=>{
 vi.stubGlobal("ogb",{workspaces:{servers:async()=>directory()}});
 await render();
 expect(host.querySelectorAll("[data-server-tile]")).toHaveLength(3);
 expect(host.querySelector('[data-server-tile="a"]')?.getAttribute("aria-current")).toBe("page");
 expect(host.querySelector<HTMLButtonElement>('[data-server-tile="gone"]')?.disabled).toBe(true);
 expect(host.querySelector('[data-server-tile="b"]')?.getAttribute("title")).toContain("Saved connection");
});
it("switches by opaque ID through the narrow native bridge and reports rejection",async()=>{
 const select=vi.fn(async()=>({ok:false,error:"failed"}));
 vi.stubGlobal("ogb",{workspaces:{servers:async()=>directory(),select}});
 await render();await act(async()=>host.querySelector<HTMLButtonElement>('[data-server-tile="b"]')!.click());
 expect(select).toHaveBeenCalledExactlyOnceWith("b");
 expect(host.querySelector("[data-server-error]")?.getAttribute("title")).toContain("Could not open this server");
});
it("refreshes the rail after creation without recreating a fixed server list",async()=>{
 let data=directory();const servers=vi.fn(async()=>data);
 vi.stubGlobal("ogb",{workspaces:{servers}});
 await render();data={...data,servers:[...data.servers,{id:"c",name:"Team C",local:true,missing:false}]};
 await act(async()=>window.dispatchEvent(new Event("aiking:servers-changed")));
 expect(host.querySelector('[data-server-tile="c"]')).not.toBeNull();
});
it("keeps web current-server context when no native directory exists",async()=>{
 await render();expect(host.querySelectorAll("[data-server-tile]")).toHaveLength(1);
 expect(host.querySelector("[data-server-tile]")?.getAttribute("aria-label")).toBe("Team A");
});
it("does not claim a failed directory load is an empty account",async()=>{
 vi.stubGlobal("ogb",{workspaces:{servers:async()=>{throw new Error("IPC unavailable");}}});
 await render();expect(host.querySelector("[data-server-error]")).not.toBeNull();
 expect(host.querySelectorAll("[data-server-tile]")).toHaveLength(1);
});
