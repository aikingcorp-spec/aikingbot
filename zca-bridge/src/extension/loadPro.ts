import type { ExtensionRegistry, ProModule } from "./registry.js";

export type Importer = (specifier: string) => Promise<unknown>;

interface MiniLog {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
}

// Đường dẫn qua BIẾN (không phải string literal) để `tsc` không đòi file tồn tại ở bản OSS.
// Dynamic import phân giải tương đối so với file này: src/extension → ../pro/index.js.
const PRO_ENTRY = "../pro/index.js";

function isModuleNotFound(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/**
 * Nạp module Pro optional và để nó đăng ký capabilities.
 * Trả `false` (chạy Free) nếu Pro vắng mặt hoặc không hợp lệ; KHÔNG bao giờ throw vì thiếu Pro.
 */
export async function loadPro(
  registry: ExtensionRegistry,
  importer: Importer = (s) => import(s),
  log?: MiniLog,
): Promise<boolean> {
  let mod: unknown;
  try {
    mod = await importer(PRO_ENTRY);
  } catch (err) {
    if (isModuleNotFound(err)) {
      log?.info({ event: "pro_absent" }, "no Pro module; running in Free mode");
      return false;
    }
    throw err;
  }
  const pro = mod as Partial<ProModule>;
  if (typeof pro.registerPro !== "function") {
    log?.warn({ event: "pro_invalid" }, "Pro module present but exports no registerPro");
    return false;
  }
  await pro.registerPro(registry);
  log?.info({ event: "pro_loaded" }, "Pro module loaded");
  return true;
}
