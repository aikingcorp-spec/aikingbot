// Dấu "/" cuối là bắt buộc: tránh khớp nhầm src/proxyRoutes, proxyOptions, proxyRepo...
const PRO_PREFIXES = ["zca-bridge/src/pro/", "src/pro/", "zca-bridge/test/pro/", "test/pro/"] as const;

/** Trả về các path thuộc module Pro — phải rỗng trên nhánh public `share-github`. */
export function findProLeaks(paths: readonly string[]): string[] {
  return paths.filter((p) => PRO_PREFIXES.some((pre) => p.startsWith(pre)));
}
