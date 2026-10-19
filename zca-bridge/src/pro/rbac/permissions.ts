/** Permission key có thể gán cho admin/operator qua ma trận UI. Thêm key khi ship feature Pro mới. */
export const PERMISSION_KEYS = ["accounts.write", "settings.write", "proxy.write", "infocard.write"] as const;

/** Key chỉ owner mới có — không bao giờ gán được cho role khác (chống tự khóa). */
export const OWNER_ONLY = new Set<string>(["users.manage", "perms.manage"]);

export type EditableRole = "admin" | "operator";
/** Ma trận: role → danh sách key được cấp. owner không lưu (implicit-all). */
export type PermissionMatrix = Record<string, string[]>;

export const DEFAULT_MATRIX: PermissionMatrix = {
  admin: [...PERMISSION_KEYS],
  operator: [],
};

/** owner → mọi key; owner-only → chỉ owner; còn lại tra ma trận. */
export function isAllowed(role: string, key: string, matrix: PermissionMatrix): boolean {
  if (role === "owner") return true;
  if (OWNER_ONLY.has(key)) return false;
  return matrix[role]?.includes(key) ?? false;
}
