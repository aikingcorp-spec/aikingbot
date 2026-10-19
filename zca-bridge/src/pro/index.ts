import type { ExtensionRegistry } from "../extension/registry.js";
import { makeRbacAdminAuth } from "./rbac/adminAuth.js";

/** Điểm vào module Pro. Core gọi qua loadPro (dynamic import optional). */
export function registerPro(registry: ExtensionRegistry): void {
  registry.register({ adminAuth: (ctx) => makeRbacAdminAuth(ctx) });
}
