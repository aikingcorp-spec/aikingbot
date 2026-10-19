import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Zalo OA webhook signature, confirmed against live events:
 *   mac = hex SHA256( appId + rawBody + timestamp + oaSecretKey )
 * The signing key is the OA Secret Key (distinct from the app Secret Key used for OAuth).
 */
export function computeMac(appId: string, data: string, timestamp: string, oaSecretKey: string): string {
  return createHash("sha256").update(appId + data + timestamp + oaSecretKey).digest("hex");
}

export function verifyMac(
  input: { appId: string; data: string; timestamp: string; mac: string },
  oaSecretKey: string,
): boolean {
  const expected = computeMac(input.appId, input.data, input.timestamp, oaSecretKey);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(input.mac ?? "", "hex");
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}
