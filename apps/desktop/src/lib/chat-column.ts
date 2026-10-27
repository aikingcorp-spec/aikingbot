// Mai v10 chat message column tokens (NOTES.md):
// msgAvatar 28 + avatarGap 8 → msgInset 36; bubbleMax 560; userBubbleMax 480.
export const MSG_AVATAR = 28;
export const AVATAR_GAP = 8;
export const MSG_INSET = MSG_AVATAR + AVATAR_GAP;
export const BUBBLE_MAX = 560;
export const USER_BUBBLE_MAX = 480;

/** Outer wrapper for transcript cards: same left inset as bot bubble content. */
export const msgCardOuterClass = "w-full box-border pl-[36px]";

/** Inner card / bot bubble max width. */
export const msgCardInnerClass = "w-full max-w-[560px]";

/** Bot text bubble max width (w-fit inside the row). */
export const botBubbleClass = "w-fit max-w-[560px]";

/** User text bubble max width. */
export const userBubbleClass = "w-fit max-w-[min(480px,78%)]";
