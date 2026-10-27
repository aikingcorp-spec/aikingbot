import { z } from "zod";

/**
 * Mascot look v3: a versioned, additive appearance config stored next to the legacy
 * `mascotBody` / `mascotExpression` / `color` fields, which keep working unchanged. A bot
 * without a valid v3 look renders exactly as before.
 *
 * Six shapes, twelve faces, seven accessories (six plus none) and nine flat colours.
 * Accessory colour is derived from the body colour, so it is not stored.
 */
export const MASCOT_LOOK_VERSION = 3;

export const MASCOT_LOOK_SHAPES = ["dome", "cloud", "squircle", "pill", "circle", "box"] as const;
export const MASCOT_LOOK_FACES = ["dots", "slits", "lid", "big", "round", "wink", "joy", "sleepy", "sad", "cross", "love", "sparkle"] as const;
export const MASCOT_LOOK_ACCESSORIES = ["none", "beret", "cap", "antenna", "sprout", "halo", "beanie"] as const;
/** The nine approved character colours, uppercase hex. */
export const MASCOT_LOOK_COLORS = [
  "#3B82F6", "#F97316", "#8B5CF6", "#22C55E", "#EC4899", "#14B8A6", "#EAB308", "#EF4444", "#0EA5E9",
] as const;

export type MascotLookShape = (typeof MASCOT_LOOK_SHAPES)[number];
export type MascotLookFace = (typeof MASCOT_LOOK_FACES)[number];
export type MascotLookAccessory = (typeof MASCOT_LOOK_ACCESSORIES)[number];
export type MascotLookColor = (typeof MASCOT_LOOK_COLORS)[number];

export interface MascotLook {
  v: typeof MASCOT_LOOK_VERSION;
  shape: MascotLookShape;
  color: MascotLookColor;
  face: MascotLookFace;
  acc: MascotLookAccessory;
}

export const DEFAULT_MASCOT_LOOK: MascotLook = { v: 3, shape: "circle", color: "#3B82F6", face: "dots", acc: "none" };

/** Strict wire/persistence schema: exact version, allowlisted values, no extra keys. */
export const mascotLookSchema = z
  .object({
    v: z.literal(MASCOT_LOOK_VERSION),
    shape: z.enum(MASCOT_LOOK_SHAPES),
    color: z.enum(MASCOT_LOOK_COLORS),
    face: z.enum(MASCOT_LOOK_FACES),
    acc: z.enum(MASCOT_LOOK_ACCESSORIES),
  })
  .strict();

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  const text = typeof value === "string" ? value : "";
  return allowed.find((candidate) => candidate === text || candidate.toUpperCase() === text.toUpperCase()) ?? fallback;
}

/**
 * Lenient reader for untrusted persisted/SSE data. Returns null (use the legacy mascot) unless
 * the value is an object carrying version 3; inside a v3 object each unknown field falls back
 * to its own default instead of blanking the avatar.
 */
export function resolveMascotLook(value: unknown): MascotLook | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.v !== MASCOT_LOOK_VERSION) return null;
  return {
    v: MASCOT_LOOK_VERSION,
    shape: pick(MASCOT_LOOK_SHAPES, raw.shape, DEFAULT_MASCOT_LOOK.shape),
    color: pick(MASCOT_LOOK_COLORS, raw.color, DEFAULT_MASCOT_LOOK.color),
    face: pick(MASCOT_LOOK_FACES, raw.face, DEFAULT_MASCOT_LOOK.face),
    acc: pick(MASCOT_LOOK_ACCESSORIES, raw.acc, DEFAULT_MASCOT_LOOK.acc),
  };
}

/**
 * Portable (backup / manifest / package / copy) form of a look: the canonical v3 object, or
 * undefined when absent, null, not v3 or malformed. An invalid look never rejects an import or
 * blocks a legacy bot; it simply is not carried, so the legacy mascot renders as before.
 */
export function portableMascotLook(value: unknown): MascotLook | undefined {
  return resolveMascotLook(value) ?? undefined;
}

/** Zod field for documents that travel between installs: lenient in, canonical out, extra keys stripped. */
export const portableMascotLookField = z.unknown().transform((value) => portableMascotLook(value)).optional();
