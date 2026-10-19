import type { MediaArchive } from "../media/archive.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

/** Dữ liệu lõi cấp cho Pro để dựng một capability (vd MediaArchive). */
export interface ExtensionContext {
  mediaArchiveRoot: string;
  publicBaseUrl: string;
  /** 32-byte HMAC secret (used for signing /media tokens). */
  credentialsKey: Buffer;
  mediaTokenTtlDays: number;
}

export type MediaArchiveFactory = (ctx: ExtensionContext) => MediaArchive;

export type AdminPreHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** Dữ liệu lõi cấp cho module auth Pro (RBAC). */
export interface AdminAuthContext {
  pool: import("pg").Pool;
  sessionSecret: Buffer;
}

/** Hợp đồng auth Pro cung cấp; core gọi muộn sau khi pool/sessionSecret sẵn sàng. */
export interface AdminAuth {
  ensureSchema(): Promise<void>;
  requirePermission(key: string): AdminPreHandler;
  registerRoutes(app: FastifyInstance): void | Promise<void>;
}

export type AdminAuthFactory = (ctx: AdminAuthContext) => AdminAuth;

/** Mỗi field = một điểm cắm optional. Thêm field khi làm feature Pro mới (YAGNI). */
export interface Capabilities {
  mediaArchive?: MediaArchiveFactory;
  adminAuth?: AdminAuthFactory;
}

/** Host registry trung lập: lõi định nghĩa interface, Pro cung cấp implementation. */
export class ExtensionRegistry {
  private caps: Capabilities = {};

  /** Gộp (merge) capabilities; field có giá trị mới ghi đè field cùng tên trước đó. */
  register(partial: Capabilities): void {
    const next: Capabilities = { ...this.caps };
    // Khi thêm capability mới vào `Capabilities`, thêm một dòng guard tương ứng ở đây.
    if (partial.mediaArchive !== undefined) next.mediaArchive = partial.mediaArchive;
    if (partial.adminAuth !== undefined) next.adminAuth = partial.adminAuth;
    this.caps = next;
  }

  get mediaArchive(): MediaArchiveFactory | undefined {
    return this.caps.mediaArchive;
  }

  get adminAuth(): AdminAuthFactory | undefined {
    return this.caps.adminAuth;
  }
}

/** Hợp đồng mà `src/pro/index.ts` (private) phải export. */
export interface ProModule {
  registerPro(registry: ExtensionRegistry): void | Promise<void>;
}
