import {
  forwardRef,
  memo,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { MAUS_COLORS, type MausColor, type MausMotion, type MausState } from "@/lib/mascot";
import type { CursorAvatarHandle } from "./CursorAvatar";
import { avatarCropRadius, botAvatarProfile, clampAvatarFocus, clampAvatarZoom, type BotAvatarCrop } from "../../shared/bot-avatar";
import type { MascotBodyId } from "../../shared/mascot-bodies";

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

const gradientFor = (color: MausColor): [string, string, string] => {
  const fill = MAUS_COLORS[color] ?? MAUS_COLORS.green;
  return [mix(fill, "#ffffff", 0.55), fill, mix(fill, "#000000", 0.42)];
};

export function roomAvatarGradient(color: MausColor): [string, string, string] {
  const fill = `var(--identity-${color})`;
  return [
    `color-mix(in srgb, ${fill} 82%, #ffffff)`,
    fill,
    `color-mix(in srgb, ${fill} 82%, #000000)`,
  ];
}

export type MausAvatarHandle = CursorAvatarHandle;

export type MausAvatarProps = {
  color: MausColor;
  state?: MausState;
  expression?: number;
  size?: number;
  label?: string;
  motion?: MausMotion;
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

function MausAvatarComponent(
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
  }: MausAvatarProps,
  ref: React.Ref<MausAvatarHandle>,
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

  return (
    <span ref={mark} className="inline-flex shrink-0" data-expression={expression} style={{ width: size, height: size, transform: turn ? `rotate(${turn}deg)` : undefined }}>
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
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={colors[0]} />
            <stop offset="0.52" stopColor={colors[1]} />
            <stop offset="1" stopColor={colors[2]} />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="18" fill={`url(#${gradientId})`} />
        <path d="M32 13 48 42H16Z" fill="none" stroke="#111318" strokeWidth="4" strokeLinejoin="round" />
        <path d="M26 33h12M32 45v6" stroke="#111318" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export const MausAvatar = memo(forwardRef(MausAvatarComponent));

export type BotAvatarProps = Omit<MausAvatarProps, "color" | "gradient"> & {
  readable?: boolean;
  bot: {
    name?: string;
    color: MausColor;
    avatarUrl?: string | null;
    avatarCrop?: BotAvatarCrop;
    avatarZoom?: number;
    avatarFocusX?: number;
    avatarFocusY?: number;
    mascotBody?: MascotBodyId | null;
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
    return (
      <MausAvatar
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
