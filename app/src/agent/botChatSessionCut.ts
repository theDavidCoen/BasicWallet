/**
 * Ask Cursor /new session cut: prevent relay gift-wrap catch-up from
 * re-inserting historical bot→owner messages after clearChatMessagesLocal.
 */

import { CURSOR_BOT_CONTACT_ID } from "./botConstants";

/**
 * True when this envelope belongs to the Ask Cursor thread and its known
 * timestamp is strictly before the /new cut.
 *
 * Prefer wrap created_at (Nostr) when present; fall back to envelope.sentAt.
 * Human threads are never skipped.
 */
export function shouldSkipBotThreadIngest(opts: {
  contactId: string;
  ignoreBeforeMs: number;
  sentAtMs?: number | null;
  wrapCreatedAtSec?: number | null;
}): boolean {
  if (opts.contactId !== CURSOR_BOT_CONTACT_ID) return false;
  const cut = opts.ignoreBeforeMs;
  if (!(cut > 0)) return false;

  let t = 0;
  if (
    typeof opts.wrapCreatedAtSec === "number" &&
    Number.isFinite(opts.wrapCreatedAtSec) &&
    opts.wrapCreatedAtSec > 0
  ) {
    t = Math.floor(opts.wrapCreatedAtSec * 1000);
  } else if (
    typeof opts.sentAtMs === "number" &&
    Number.isFinite(opts.sentAtMs) &&
    opts.sentAtMs > 0
  ) {
    t = Math.floor(opts.sentAtMs);
  }
  if (!(t > 0)) return false;
  return t < cut;
}
