import { activeLocale } from "@/lib/i18n";
import type { MascotLookAccessory, MascotLookColor, MascotLookFace, MascotLookShape } from "../../shared/mascot-look";

type Pair = readonly [en: string, vi: string];

const SHAPE: Record<MascotLookShape, Pair> = {
  dome: ["Dome", "Vòm"], cloud: ["Cloud", "Đám mây"], squircle: ["Squircle", "Vuông bo tròn"],
  pill: ["Pill", "Viên thuốc"], circle: ["Circle", "Tròn"], box: ["Box", "Vuông bo"],
};
const FACE: Record<MascotLookFace, Pair> = {
  dots: ["Small dots", "Chấm nhỏ"], slits: ["Vertical slits", "Vạch đứng"], lid: ["Heavy lids", "Mắt lim dim"],
  big: ["Big eyes", "Mắt to"], round: ["Round eyes", "Mắt tròn"], wink: ["Wink", "Nháy mắt"],
  joy: ["Joy", "Cười híp"], sleepy: ["Sleepy", "Ngủ gật"], sad: ["Sad", "Buồn"],
  cross: ["Dazed", "Choáng"], love: ["Love", "Mê tít"], sparkle: ["Sparkle", "Lấp lánh"],
};
const ACC: Record<MascotLookAccessory, Pair> = {
  none: ["None", "Không"], beret: ["Beret", "Mũ beret"], cap: ["Cap", "Mũ lưỡi trai"], antenna: ["Antenna", "Ăng-ten"],
  sprout: ["Sprout", "Mầm cây"], halo: ["Halo", "Vòng hào quang"], beanie: ["Beanie", "Mũ len"],
};
const COLOR: Record<MascotLookColor, Pair> = {
  "#3B82F6": ["Blue", "Xanh dương"], "#F97316": ["Orange", "Cam"], "#8B5CF6": ["Purple", "Tím"],
  "#22C55E": ["Green", "Xanh lá"], "#EC4899": ["Pink", "Hồng"], "#14B8A6": ["Teal", "Ngọc"],
  "#EAB308": ["Yellow", "Vàng"], "#EF4444": ["Red", "Đỏ"], "#0EA5E9": ["Sky blue", "Xanh trời"],
};

const GROUPS = { shape: ["Shape", "Hình dáng"], face: ["Eyes", "Mắt"], acc: ["Accessory", "Phụ kiện"], color: ["Color", "Màu"] } as const satisfies Record<string, Pair>;
const WORDS = { customize: ["Character look", "Diện mạo nhân vật"], reset: ["Back to classic mascot", "Về mascot cũ"] } as const satisfies Record<string, Pair>;

const isVi = () => activeLocale().toLowerCase().startsWith("vi");
const choose = (pair: Pair) => (isVi() ? pair[1] : pair[0]);

export const mascotLookLabel = {
  shape: (id: MascotLookShape) => choose(SHAPE[id]),
  face: (id: MascotLookFace) => choose(FACE[id]),
  acc: (id: MascotLookAccessory) => choose(ACC[id]),
  color: (id: MascotLookColor) => choose(COLOR[id]),
  group: (id: keyof typeof GROUPS) => choose(GROUPS[id]),
  word: (id: keyof typeof WORDS) => choose(WORDS[id]),
};
