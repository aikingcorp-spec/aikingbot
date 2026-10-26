// Mascot look v3: flat SVG, no gradient, no raster, no animation. Geometry is ported 1:1 from the approved
// preview (OUTBOX/G6/MASCOT-PREVIEW/V3/mascot3.js); a parity test compares the two for every combination.
import { memo, type ReactNode } from "react";
import { resolveMascotLook, type MascotLook } from "../../shared/mascot-look";

const INK = "#1E293B";
const WHITE = "#FFFFFF";

export function mixHex(hex: string, toward: string, amount: number): string {
  const parts = (value: string) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));
  const a = parts(hex);
  const b = parts(toward);
  return `#${a.map((v, i) => Math.round(v + (b[i]! - v) * amount).toString(16).padStart(2, "0")).join("")}`;
}

const eye = (x: number, y: number, rx: number, ry: number) => (
  <rect x={x - rx} y={y - ry} width={2 * rx} height={2 * ry} rx={(Math.min(rx, ry) * 0.78).toFixed(1)} fill={INK} />
);
const stroke = (d: string, width = 5) => (
  <path d={d} fill="none" stroke={INK} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
);
const heart = (x: number, y: number) => (
  <path
    d={`M${x} ${y + 12} C${x - 20} ${y - 2} ${x - 9} ${y - 16} ${x} ${y - 7} C${x + 9} ${y - 16} ${x + 20} ${y - 2} ${x} ${y + 12} Z`}
    fill="#EF4444"
  />
);
const spark = (x: number, y: number) => (
  <path
    d={`M${x} ${y - 14} Q${x} ${y} ${x + 14} ${y} Q${x} ${y} ${x} ${y + 14} Q${x} ${y} ${x - 14} ${y} Q${x} ${y} ${x} ${y - 14} Z`}
    fill="#F59E0B"
  />
);

const FACES: Record<MascotLook["face"], ReactNode> = {
  dots: <>{eye(44, 66, 5, 5)}{eye(76, 66, 5, 5)}</>,
  slits: <><rect x="39" y="54" width="9" height="26" rx="4.5" fill={INK} /><rect x="72" y="54" width="9" height="26" rx="4.5" fill={INK} /></>,
  lid: <><path d="M34 70 A10 10 0 0 1 54 70 Z" fill={INK} /><path d="M66 70 A10 10 0 0 1 86 70 Z" fill={INK} /></>,
  big: <>{eye(44, 66, 6, 11)}{eye(76, 66, 6, 11)}</>,
  round: <>{eye(44, 66, 11, 11)}{eye(76, 66, 11, 11)}</>,
  wink: <>{eye(44, 66, 6, 11)}{stroke("M68 66 Q76 58 84 66")}</>,
  joy: <>{stroke("M33 70 Q44 56 55 70")}{stroke("M65 70 Q76 56 87 70")}</>,
  sleepy: <>{stroke("M33 62 Q44 74 55 62")}{stroke("M65 62 Q76 74 87 62")}</>,
  sad: <>{eye(44, 70, 9, 12)}{eye(76, 70, 9, 12)}{stroke("M32 56 L54 50")}{stroke("M88 56 L66 50")}</>,
  cross: <>{stroke("M35 56 L53 76 M53 56 L35 76", 6)}{stroke("M67 56 L85 76 M85 56 L67 76", 6)}</>,
  love: <>{heart(44, 66)}{heart(76, 66)}</>,
  sparkle: <>{spark(44, 66)}{spark(76, 66)}</>,
};

const ACCESSORIES: Record<Exclude<MascotLook["acc"], "none">, { back: boolean; draw: (c: string) => ReactNode }> = {
  beret: { back: false, draw: (c) => <><ellipse cx="58" cy="30" rx="34" ry="12" fill={c} /><circle cx="62" cy="16" r="4.5" fill={c} /></> },
  cap: {
    back: false,
    draw: (c) => (
      <>
        <rect x="70" y="34" width="42" height="12" rx="6" fill={mixHex(c, "#000000", 0.18)} />
        <path d="M22 44 Q22 14 58 14 Q94 14 94 44 Q94 46 92 46 H24 Q22 46 22 44 Z" fill={c} />
      </>
    ),
  },
  antenna: { back: true, draw: (c) => <><path d="M60 28 V10" stroke={c} strokeWidth="4" strokeLinecap="round" /><circle cx="60" cy="8" r="6" fill={c} /></> },
  sprout: {
    back: true,
    draw: (c) => (
      <>
        <path d="M60 30 V16" stroke={c} strokeWidth="4" strokeLinecap="round" />
        <path d="M60 18 C60 6 46 6 46 6 C46 16 52 18 60 18 Z M60 18 C60 8 74 8 74 8 C74 18 68 20 60 18 Z" fill={c} />
      </>
    ),
  },
  halo: { back: true, draw: (c) => <ellipse cx="60" cy="14" rx="22" ry="6" fill="none" stroke={c} strokeWidth="5" /> },
  beanie: {
    back: false,
    draw: (c) => (
      <>
        <path d="M24 42 Q24 12 58 12 Q92 12 92 42 Z" fill={c} />
        <rect x="20" y="38" width="76" height="10" rx="5" fill={mixHex(c, "#000000", 0.18)} />
        <circle cx="58" cy="8" r="6" fill={mixHex(c, "#ffffff", 0.3)} />
      </>
    ),
  },
};

type Shell = { x: number; w: number; y: number; h: number; rx: number; path?: string };
const DOME_PATH = "M14 68 C14 40 34 24 60 24 C86 24 106 40 106 68 Q106 100 80 100 H40 Q14 100 14 68 Z";
const CLOUD_PATH = "M32 100 A18 18 0 0 1 20 68 A20 20 0 0 1 44 42 A22 22 0 0 1 82 40 A20 20 0 0 1 100 68 A18 18 0 0 1 88 100 Z";
const SHELLS: Record<MascotLook["shape"], Shell> = {
  cloud: { x: 14, w: 92, y: 24, h: 76, rx: 0, path: CLOUD_PATH },
  dome: { x: 14, w: 92, y: 24, h: 76, rx: 36, path: DOME_PATH },
  squircle: { x: 14, w: 92, y: 26, h: 76, rx: 36 },
  pill: { x: 8, w: 104, y: 34, h: 68, rx: 34 },
  circle: { x: 17, w: 86, y: 26, h: 76, rx: 43 },
  box: { x: 14, w: 92, y: 26, h: 76, rx: 22 },
};

/** Sizes up to this use the cropped viewBox so the figure fills small slots. */
export const MASCOT_LOOK_CROP_MAX_SIZE = 40;

export type MascotLookAvatarProps = {
  look: MascotLook;
  size?: number;
  /** Accessible name. Without it the avatar is decorative (aria-hidden). */
  label?: string;
};

function MascotLookAvatarComponent({ look: input, size = 44, label }: MascotLookAvatarProps) {
  const look = resolveMascotLook(input) ?? resolveMascotLook({ v: 3 })!;
  const shell = SHELLS[look.shape];
  const accent = mixHex(look.color, "#000000", 0.28);
  const accessory = look.acc === "none" ? null : ACCESSORIES[look.acc];
  const crop = size <= MASCOT_LOOK_CROP_MAX_SIZE;
  return (
    <span className="inline-flex shrink-0" data-mascot-look={look.v} style={{ width: size, height: size }}>
      <svg
        viewBox={crop ? "4 -2 112 108" : "0 0 120 108"}
        width={size}
        height={size}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        focusable="false"
      >
        {label ? <title>{label}</title> : null}
        {accessory?.back ? accessory.draw(accent) : null}
        {shell.path ? (
          <>
            <path d={shell.path} fill={look.color} />
            <rect x="24" y="44" width="72" height="44" rx="20" fill={WHITE} />
          </>
        ) : (
          <>
            <rect x={shell.x} y={shell.y} width={shell.w} height={shell.h} rx={shell.rx} fill={look.color} />
            <rect x={shell.x + 11} y={shell.y + 13} width={shell.w - 22} height={shell.h - 22} rx={Math.max(shell.rx - 11, 14)} fill={WHITE} />
          </>
        )}
        {FACES[look.face]}
        {accessory && !accessory.back ? <g transform={`translate(${shell.x + shell.w / 2 - 60} ${shell.y - 26})`}>{accessory.draw(accent)}</g> : null}
      </svg>
    </span>
  );
}

export const MascotLookAvatar = memo(MascotLookAvatarComponent);
