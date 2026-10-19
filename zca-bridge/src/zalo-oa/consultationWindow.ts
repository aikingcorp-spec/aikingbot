export const WINDOW_HOURS = 48;
export const FREE_LIMIT = 8;
export const NEAR_LIMIT_AT = 6;

export interface WindowState { lastInboundAt: Date | null; sentCount: number; }
export interface WindowDecision { withinWindow: boolean; newCount: number; warning: string | null; }

const OUT_OF_WINDOW_NOTE =
  "⚠️ Ngoài cửa sổ 48h tư vấn (user chưa nhắn lại gần đây) — tin này có thể bị Zalo tính phí hoặc chặn. (ước tính)";
const LIMIT_REACHED_NOTE =
  "⚠️ Đã dùng hết 8 tin tư vấn miễn phí trong kỳ 48h — các tin tiếp theo có thể bị tính phí. (ước tính)";
const nearLimitNote = (n: number) => `ℹ️ Đã dùng ${n}/8 tin tư vấn miễn phí trong kỳ 48h. (ước tính)`;

/** Decide whether an outbound OA message warrants a consultation-window warning note. */
export function evaluate(state: WindowState, now: Date): WindowDecision {
  const within = state.lastInboundAt != null
    && now.getTime() - state.lastInboundAt.getTime() <= WINDOW_HOURS * 3_600_000;
  if (!within) {
    return { withinWindow: false, newCount: state.sentCount, warning: OUT_OF_WINDOW_NOTE };
  }
  const newCount = state.sentCount + 1;
  let warning: string | null = null;
  if (newCount === FREE_LIMIT) warning = LIMIT_REACHED_NOTE;
  else if (newCount === NEAR_LIMIT_AT) warning = nearLimitNote(newCount);
  return { withinWindow: true, newCount, warning };
}
