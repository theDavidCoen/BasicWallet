/**
 * Home chat unread banner dismiss watermark.
 * Hides the current banner wave without clearing unread_count (CTA badge stays).
 * Banner returns only when newer unread activity arrives after the watermark.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { listUnreadChatThreads } from "./chatStore";

const WATERMARK_KEY = "basic.chat.unreadBanner.dismissWatermark.v1";

/** Max last_message_at (ms) among threads with unread_count > 0; 0 if none. */
export function unreadActivityHighWaterMs(): number {
  let max = 0;
  for (const t of listUnreadChatThreads()) {
    const at = t.lastMessageAt ?? t.updatedAt ?? 0;
    if (at > max) max = at;
  }
  return max;
}

export async function readChatBannerDismissWatermark(): Promise<number> {
  const raw = await AsyncStorage.getItem(WATERMARK_KEY);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Persist watermark for the current unread wave (call on X dismiss). */
export async function dismissChatUnreadBannerWave(): Promise<number> {
  const watermark = unreadActivityHighWaterMs();
  await AsyncStorage.setItem(WATERMARK_KEY, String(watermark));
  return watermark;
}

/**
 * Banner should show when there is unread and the wave is newer than the
 * last dismiss watermark (or never dismissed).
 */
export function shouldShowChatUnreadBanner(
  totalUnread: number,
  dismissWatermarkMs: number,
): boolean {
  if (totalUnread <= 0) return false;
  if (dismissWatermarkMs <= 0) return true;
  return unreadActivityHighWaterMs() > dismissWatermarkMs;
}
