// @vitest-environment happy-dom
import { act, createElement } from "react";
import {createRoot,type Root} from "react-dom/client";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {WorkspacePanel} from "./WorkspacePanel";
import {MarketplaceButton} from "./WorkspaceChrome";
import {setLocale} from "@/lib/i18n";
const mocks=vi.hoisted(()=>({dispatch:vi.fn(),close:vi.fn(),admin:true}));
vi.mock("@/state/store",()=>({useStore:()=>({dispatch:mocks.dispatch})}));
vi.mock("@/lib/use-owner-or-admin",()=>({useOwnerOrAdmin:()=>mocks.admin}));
vi.mock("@/lib/interface-mode",()=>({setAdvancedMode:vi.fn()}));
vi.mock("@/lib/session",()=>({readSessionState:async()=>({kind:"session",scopes:mocks.admin?["admin"]:["client"]}),isOwnerOrAdmin:(value:{scopes:string[]})=>value.scopes.includes("admin")}));
vi.mock("./workspace-identity",()=>({useWorkspaceIdentity:()=>({name:"Fixture workspace",local:false})}));
vi.mock("./account/account-api",()=>({readAccountState:async()=>({account:{email:"person@example.test"},workspaces:[],devices:[]})}));
let host:HTMLDivElement;let root:Root;
beforeEach(()=>{
 vi.clearAllMocks();mocks.admin=true;setLocale("en");
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("ogb",undefined);
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=()=>act(async()=>root.render(createElement(WorkspacePanel,{onClose:mocks.close})));
const click=async(selector:string)=>act(async()=>document.querySelector<HTMLButtonElement>(selector)!.click());
const input=async(text:string)=>act(async()=>{
 const field=document.querySelector<HTMLInputElement>("[data-workspace-input]")!;
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,text);
 field.dispatchEvent(new Event("input",{bubbles:true}));
 field.dispatchEvent(new Event("change",{bubbles:true}));
});
it("offers exactly three server paths and marks unsupported creation honestly",async()=>{
 await render();expect(document.querySelector("[data-workspace-create]")?.getAttribute("data-available")).toBe("false");
 expect(document.querySelector("[data-workspace-join]")).not.toBeNull();
 expect(document.querySelector("[data-current-workspace]")?.textContent).toBe("Fixture workspace");
 await click("[data-workspace-advanced]");
 await click("[data-server-full-settings]");
 expect(mocks.dispatch).toHaveBeenCalledWith({type:"toggleAppSettings",open:true,section:"general"});
});
it("does not offer a member the invitation controls",async()=>{
 mocks.admin=false;await render();expect(document.querySelector("[data-workspace-panel]")?.textContent).not.toContain("Invite members");
});
it("creates and switches a local workspace using the existing desktop bridge",async()=>{
 const state={packaged:true,remote:false,activeId:"local",environments:[] as {id:string;kind:string;name:string}[]};
 const create=vi.fn(async()=>{state.environments.push({id:"new-local",kind:"local",name:"Team"});return{ok:true,state};});
 const swap=vi.fn(async()=>({ok:true}));
 vi.stubGlobal("ogb",{confirm:async()=>true,environments:{state:async()=>({...state,environments:[...state.environments]}),create,switch:swap}});
 await render();await click("[data-workspace-create]");await input("Team");
 await act(async()=>document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(create).toHaveBeenCalledExactlyOnceWith("Team");
 expect(swap).toHaveBeenCalledExactlyOnceWith("new-local");
});
it("preserves the invite in the existing native connection flow",async()=>{
 const add=vi.fn(async()=>true);
 vi.stubGlobal("ogb",{environments:{state:async()=>({packaged:true,remote:false,activeId:"local",environments:[]}),addFromLink:add}});
 await render();await click("[data-workspace-join]");await input("https://workspace.example.com/pair?email=member%40example.com");
 await act(async()=>document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(add).toHaveBeenCalledExactlyOnceWith("https://workspace.example.com/pair?email=member%40example.com");
});
it("keeps remote desktop pages inside the native workspace chooser",async()=>{
 const menu=vi.fn(async()=>{});
 vi.stubGlobal("ogb",{workspaces:{menu}});
 await render();await click("[data-workspace-advanced]");await click("[data-server-full-settings]");
 expect(menu).toHaveBeenCalledOnce();
});

it("only offers Marketplace to roles that can use its owner-only API",async()=>{
 mocks.admin=false;await act(async()=>root.render(createElement(MarketplaceButton)));
 expect(host.querySelector("button")).toBeNull();
 mocks.admin=true;await act(async()=>root.render(createElement(MarketplaceButton)));
 expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Marketplace");
});

it("explains web creation availability without a fake provision action",async()=>{
 await render();await click("[data-workspace-create]");
 expect(document.querySelector("[data-server-unavailable]")?.textContent).toContain("installed Desktop");
 expect(document.querySelector("form")).toBeNull();
});
it("uses bounded native creation on a remote Desktop renderer",async()=>{
 const create=vi.fn(async()=>({ok:false,error:"cancelled"}));
 vi.stubGlobal("ogb",{workspaces:{create}});
 await act(async()=>root.render(createElement(WorkspacePanel,{onClose:mocks.close,directory:{activeId:"a",canCreate:true,servers:[]}})));
 await click("[data-workspace-create]");await input("B");
 await act(async()=>document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(create).toHaveBeenCalledExactlyOnceWith("B");expect(document.querySelector("[role=alert]")).toBeNull();
 expect(mocks.close).not.toHaveBeenCalled();
});
it("says why a create failed when the reason is known",async()=>{
 const create=vi.fn(async()=>({ok:false,error:"duplicate"}));
 vi.stubGlobal("ogb",{workspaces:{create}});
 await act(async()=>root.render(createElement(WorkspacePanel,{onClose:mocks.close,directory:{activeId:"a",canCreate:true,servers:[]}})));
 await click("[data-workspace-create]");await input("B");
 await act(async()=>document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(document.querySelector("[role=alert]")?.textContent).toContain("folder already exists");
});
it("reports an unsuccessful create without inventing a server",async()=>{
 const create=vi.fn(async()=>({ok:false,error:"create"}));
 vi.stubGlobal("ogb",{workspaces:{create}});
 await act(async()=>root.render(createElement(WorkspacePanel,{onClose:mocks.close,directory:{activeId:"a",canCreate:true,servers:[]}})));
 await click("[data-workspace-create]");await input("B");
 await act(async()=>document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
 expect(document.querySelector("[role=alert]")?.textContent).toContain("Could not create this server");
});
