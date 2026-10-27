// AIKING stage 2: original AIKINGBOT agent avatars (flat body shapes with expressive eyes).
import {
  forwardRef,
  memo,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { AIKING_COLORS, type AikingColor, type AikingMotion, type AikingState } from "@/lib/mascot";
import type { CursorAvatarHandle } from "./CursorAvatar";
import { avatarCropRadius, botAvatarProfile, clampAvatarFocus, clampAvatarZoom, type BotAvatarCrop } from "../../shared/bot-avatar";
import type { MascotBodyId } from "../../shared/mascot-bodies";
import { resolveMascotLook, type MascotLook } from "../../shared/mascot-look";
import { MascotLookAvatar } from "./MascotLookAvatar";

export const EYE_SCALE = 1.12;
export const MOUTH_WEIGHT = 11;

function mix(hex: string, toward: string, t: number): string {
  const a = Number.parseInt(hex.slice(1), 16);
  const b = Number.parseInt(toward.slice(1), 16);
  const channel = (shift: number) => {
    const va = (a >> shift) & 0xff;
    const vb = (b >> shift) & 0xff;
    return Math.round(va + (vb - va) * t);
  };
  return `#${[channel(16), channel(8), channel(0)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

const gradientFor = (color: AikingColor): [string, string, string] => {
  const fill = AIKING_COLORS[color] ?? AIKING_COLORS.green;
  return [mix(fill, "#ffffff", 0.55), fill, mix(fill, "#000000", 0.42)];
};

export function roomAvatarGradient(color: AikingColor): [string, string, string] {
  const fill = `var(--identity-${color})`;
  return [
    `color-mix(in srgb, ${fill} 82%, #ffffff)`,
    fill,
    `color-mix(in srgb, ${fill} 82%, #000000)`,
  ];
}

export type AikingAvatarHandle = CursorAvatarHandle;

export type AikingAvatarProps = {
  color: AikingColor;
  state?: AikingState;
  expression?: number;
  size?: number;
  label?: string;
  motion?: AikingMotion;
  motionKey?: number;
  turn?: number;
  gaze?: { x?: number; y?: number };
  spring?: number;
  eyeScale?: number;
  showMouth?: boolean;
  mouthStroke?: number;
  forward?: boolean;
  lookAround?: number;
  trackPointer?: boolean;
  animated?: boolean;
  bodyId?: MascotBodyId;
  gradient?: [string, string, string];
};

function AikingAvatarComponent(
  {
    color,
    state = "idle",
    expression,
    size = 44,
    label,
    motion = "none",
    motionKey = 0,
    turn,
    animated = true,
    gradient,
    bodyId,
  }: AikingAvatarProps,
  ref: React.Ref<AikingAvatarHandle>,
) {
  const mark = useRef<HTMLSpanElement>(null);
  const gradientId = `aiking-avatar-${useId().replace(/:/g, "")}`;
  const colors = gradient ?? gradientFor(color);
  const canAnimate = () => animated && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const blink = () => {
    if (canAnimate()) mark.current?.animate?.([{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }], { duration: 240 });
  };
  const spin = (durationMs = 620) => {
    if (canAnimate()) mark.current?.animate?.([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: durationMs, easing: "ease-in-out" });
  };
  useImperativeHandle(ref, () => ({
    blink,
    spin,
    setExpression: (index: number) => {
      if (mark.current) mark.current.dataset.expression = String(index);
    },
  }));
  useEffect(() => {
    if (motion === "none") return;
    if (motion === "arrive" || motion === "switch" || motion === "celebrate") spin();
    else blink();
  }, [motion, motionKey, animated]);

  const face = faceFor(state);
  const shape = bodyShape(bodyId);
  return (
    <span ref={mark} className="inline-flex shrink-0" data-expression={expression} data-body={bodyId ?? "cursor"} style={{ width: size, height: size, transform: turn ? `rotate(${turn}deg)` : undefined }}>
      <svg
        viewBox="0 0 64 64"
        width={size}
        height={size}
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        data-state={state}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={colors[1]} />
            <stop offset="1" stopColor={mixToward(colors[1], colors[2], 0.28)} />
          </linearGradient>
        </defs>
        {shape(`url(#${gradientId})`)}
        <g transform={bodyId === "capsule" ? "translate(0 0)" : bodyId === "drop" ? "translate(0 4)" : bodyId === "star" ? "translate(0 2)" : undefined}>{face}</g>
      </svg>
    </span>
  );
}

function mixToward(a: string, b: string, t: number): string {
  if (!a.startsWith("#") || !b.startsWith("#")) return a;
  return mix(a, b, t);
}

/** Original AIKINGBOT agent bodies: one flat shape per body id. */
function bodyShape(bodyId: MascotBodyId | undefined): (fill: string) => React.ReactNode {
  switch (bodyId) {
    case "circle":
      return (fill) => <circle cx="32" cy="32" r="29" fill={fill} />;
    case "blob":
      return (fill) => <path d="M33 3c15 0 28 9 28 27 0 19-13 31-30 31C14 61 3 50 3 34 3 16 17 3 33 3Z" fill={fill} />;
    case "squircle":
      return (fill) => <rect x="4" y="4" width="56" height="56" rx="22" fill={fill} />;
    case "capsule":
      return (fill) => <rect x="2" y="14" width="60" height="36" rx="18" fill={fill} />;
    case "drop":
      return (fill) => <path d="M32 2c10 13 27 26 27 39 0 12-12 21-27 21S5 53 5 41C5 28 22 15 32 2Z" fill={fill} />;
    case "shield":
      return (fill) => <path d="M32 3 57 11v19c0 16-11 27-25 31C18 57 7 46 7 30V11Z" fill={fill} strokeLinejoin="round" />;
    case "hexagon":
      return (fill) => <path d="M18 5h28l15 27-15 27H18L3 32Z" fill={fill} strokeLinejoin="round" />;
    case "diamond":
      return (fill) => <rect x="12" y="12" width="40" height="40" rx="10" transform="rotate(45 32 32)" fill={fill} />;
    case "star":
      return (fill) => <path d="M32 3l8 15 17-2-7 16 11 13-17 3-4 17-8-12-8 12-4-17-17-3 11-13-7-16 17 2Z" fill={fill} strokeLinejoin="round" />;
    default:
      return (fill) => <rect x="3" y="3" width="58" height="58" rx="17" fill={fill} />;
  }
}

type Face = "dots" | "happy" | "closed" | "up" | "down" | "wide" | "wink" | "sad" | "angry" | "curious" | "drowsy" | "attentive" | "sleeping" | "squint" | "proud";

/** Every pickable expression has its own face; the other states borrow the nearest one. */
const FACE_BY_STATE: Record<string, Face> = {
  idle: "dots",
  happy: "happy", laughing: "happy", celebrate: "happy", excited: "happy", playful: "happy", bouncing: "happy",
  curious: "curious", confused: "curious",
  drowsy: "drowsy", bored: "drowsy",
  working: "down", writing: "down", loading: "down", progress: "down", uploading: "down", sending: "down", receiving: "down", dictating: "down", humming: "down", spawning: "down", dragging: "down",
  thinking: "up", searching: "up", orbit: "up", radar: "up",
  listening: "attentive",
  sleeping: "sleeping",
  suspicious: "squint",
  proud: "proud",
  surprised: "wide", scared: "wide", alerting: "wide", notifying: "wide", waking: "wide",
  shy: "wink", sad: "sad", angry: "angry",
};

function faceFor(state: string): React.ReactNode {
  const eye = "#ffffff";
  const stroke = { stroke: eye, strokeWidth: 3.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (FACE_BY_STATE[state] ?? "dots") {
    case "happy":
      return <><path d="M20 35q4-6 8 0" {...stroke} /><path d="M36 35q4-6 8 0" {...stroke} /></>;
    case "proud":
      return <><path d="M20 33q4-5 8 0" {...stroke} /><path d="M36 33q4-5 8 0" {...stroke} /><path d="M27 41q5 3.5 10 0" {...stroke} strokeWidth={2.8} /></>;
    case "closed":
      return <><path d="M20 33.5h8" {...stroke} /><path d="M36 33.5h8" {...stroke} /></>;
    case "sleeping":
      return <><path d="M20 34q4 3 8 0" {...stroke} /><path d="M36 34q4 3 8 0" {...stroke} /><path d="M45 18h5l-5 6h5" {...stroke} strokeWidth={2.2} /></>;
    case "drowsy":
      return <><path d="M20 31.5h8" {...stroke} strokeWidth={2.6} /><path d="M36 31.5h8" {...stroke} strokeWidth={2.6} /><path d="M20.5 33a3.5 3.5 0 0 0 7 0Z" fill={eye} /><path d="M36.5 33a3.5 3.5 0 0 0 7 0Z" fill={eye} /></>;
    case "up":
      return <><circle cx="26" cy="28.5" r="3.6" fill={eye} /><circle cx="42" cy="28.5" r="3.6" fill={eye} /></>;
    case "down":
      return <><ellipse cx="23" cy="36" rx="3.8" ry="3" fill={eye} /><ellipse cx="39" cy="36" rx="3.8" ry="3" fill={eye} /></>;
    case "curious":
      return <><circle cx="24" cy="32" r="5" fill={eye} /><circle cx="40" cy="33" r="2.8" fill={eye} /><path d="M35 25l8-2" {...stroke} strokeWidth={2.4} /></>;
    case "attentive":
      return <><ellipse cx="24" cy="31" rx="3" ry="4.4" fill={eye} /><ellipse cx="40" cy="31" rx="3" ry="4.4" fill={eye} /><path d="M8 27q-3 5 0 10M56 27q3 5 0 10" {...stroke} strokeWidth={2.2} /></>;
    case "squint":
      return <><path d="M19 32l9 1.2" {...stroke} /><path d="M45 32l-9 1.2" {...stroke} /><path d="M27 41h10" {...stroke} strokeWidth={2.6} /></>;
    case "wide":
      return <><ellipse cx="24" cy="32" rx="3.6" ry="5" fill={eye} /><ellipse cx="40" cy="32" rx="3.6" ry="5" fill={eye} /></>;
    case "wink":
      return <><circle cx="24" cy="32" r="3.6" fill={eye} /><path d="M36 33q4-5 8 0" {...stroke} /></>;
    case "sad":
      return <><circle cx="24" cy="34" r="3.4" fill={eye} /><circle cx="40" cy="34" r="3.4" fill={eye} /><path d="M19 27l7-2.5M45 27l-7-2.5" {...stroke} strokeWidth={2.6} /></>;
    case "angry":
      return <><circle cx="24" cy="34" r="3.4" fill={eye} /><circle cx="40" cy="34" r="3.4" fill={eye} /><path d="M19 25l7 3M45 25l-7 3" {...stroke} strokeWidth={2.6} /></>;
    default:
      return <><circle cx="24" cy="32" r="3.6" fill={eye} /><circle cx="40" cy="32" r="3.6" fill={eye} /></>;
  }
}

export const AikingAvatar = memo(forwardRef(AikingAvatarComponent));

export type BotAvatarProps = Omit<AikingAvatarProps, "color" | "gradient"> & {
  readable?: boolean;
  bot: {
    name?: string;
    color: AikingColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: MascotBodyId | null;
    /** Versioned v3 look. Drawn instead of the legacy mascot whenever it is valid; legacy fields stay the fallback. */
    mascotLook?: MascotLook | null;
  };
};

export type BotAvatarOutcome = "flatImage" | "gradientMascot";

/** Mirrored name for name by resolveBotAvatarOutcome in ios/Sources/CompanionCore/BotAvatarRendering.swift. */
export function resolveBotAvatarOutcome(params: {
  avatarCrop: BotAvatarCrop;
  hasUrl: boolean;
  imageFailed: boolean;
}): BotAvatarOutcome {
  const { avatarCrop, hasUrl, imageFailed } = params;
  if (!hasUrl) return "gradientMascot";
  if (avatarCrop === "mascot") return "gradientMascot";
  if (imageFailed) return "gradientMascot";
  return "flatImage";
}

export function BotAvatar({ bot, size = 44, label, readable = false, ...mascotProps }: BotAvatarProps) {
  const profile = botAvatarProfile(bot);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => setImageFailed(false), [profile.avatarUrl]);

  const outcome = resolveBotAvatarOutcome({
    avatarCrop: profile.avatarCrop,
    hasUrl: Boolean(profile.avatarUrl),
    imageFailed,
  });

  if (outcome !== "flatImage") {
    const look = resolveMascotLook(bot.mascotLook);
    // The v3 look is a flat drawing with no task state: it does not borrow expressions or motion from the legacy mascot.
    if (look) return <MascotLookAvatar look={look} size={size} label={label ?? bot.name} />;
    return (
      <AikingAvatar
        bodyId={bot.mascotBody ?? undefined}
        {...mascotProps}
        color={bot.color}
        gradient={readable ? roomAvatarGradient(bot.color) : undefined}
        size={size}
        label={label ?? bot.name}
      />
    );
  }

  const radius = avatarCropRadius(profile.avatarCrop);
  const zoom = clampAvatarZoom(bot.avatarZoom ?? 1);
  const focusX = clampAvatarFocus(bot.avatarFocusX ?? 0.5);
  const focusY = clampAvatarFocus(bot.avatarFocusY ?? 0.5);
  const origin = `${focusX * 100}% ${focusY * 100}%`;
  return (
    <span
      className="relative block shrink-0 overflow-hidden bg-raised"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      <img
        src={profile.avatarUrl}
        alt={label ?? (bot.name ? `${bot.name} avatar` : "Bot avatar")}
        width={size}
        height={size}
        draggable={false}
        onError={() => setImageFailed(true)}
        className="block size-full max-w-none object-cover"
        style={{
          width: size,
          height: size,
          objectPosition: origin,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: origin,
        }}
      />
    </span>
  );
}

export function InitialsAvatar({
  initials,
  size = 32,
}: {
  initials: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary font-medium"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
}
