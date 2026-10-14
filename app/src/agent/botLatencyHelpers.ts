/**
 * Pure helpers for Ask Cursor latency P0 (fast-path id, ack match, local→wrap bridge).
 * Kept free of RN/AsyncStorage so unit tests can run under plain tsx.
 */

export const BOT_WORKING_ACK = "Working on it…";

/** How long a local fast-path turn may still suppress the gift-wrap re-enqueue. */
export const PENDING_LOCAL_TTL_MS = 180_000;

/**
 * Max skew between local send wall-clock and envelope/rumor time.
 * Must NOT use kind-1059 wrap.created_at — NIP-59 randomizes it up to 2 days back.
 */
export const BRIDGE_EVENT_WINDOW_MS = 120_000;

export function localBotTurnId(localMessageId: string): string {
  return `local:${localMessageId}`;
}

/** True if bubble is (or was) the working ack, including status suffixes. */
export function isBotWorkingAckBody(body: string | null | undefined): boolean {
  if (!body) return false;
  return body === BOT_WORKING_ACK || body.startsWith(`${BOT_WORKING_ACK} `);
}

export function formatWorkingAckStatus(status: string): string {
  const s = status.trim().toUpperCase();
  if (!s || s === "UNKNOWN") return BOT_WORKING_ACK;
  if (s === "CREATING") return `${BOT_WORKING_ACK} Creating…`;
  if (s === "RUNNING") return `${BOT_WORKING_ACK} Cursor is working…`;
  return `${BOT_WORKING_ACK} ${s}`;
}

export type PendingLocalTurn = {
  localId: string;
  body: string;
  at: number;
};

export function prunePendingLocalTurns(
  turns: PendingLocalTurn[],
  now = Date.now(),
): void {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (now - turns[i].at > PENDING_LOCAL_TTL_MS) {
      turns.splice(i, 1);
    }
  }
}

/**
 * Match a gift-wrap to a pending local fast-path turn.
 *
 * @param opts.eventTimeMs Real send time from envelope.sentAt or rumor.created_at*1000.
 *   Never pass kind-1059 wrap.created_at (NIP-59 randomNow).
 * @returns the matched turn (removed from `turns`), or null.
 */
export function takePendingLocalTurn(
  turns: PendingLocalTurn[],
  opts: { body: string; eventTimeMs?: number; now?: number },
): PendingLocalTurn | null {
  const body = opts.body.trim();
  if (!body) return null;
  const now = opts.now ?? Date.now();
  prunePendingLocalTurns(turns, now);
  const idx = turns.findIndex((t) => {
    if (t.body !== body) return false;
    // Local turn itself must still be fresh (wall clock).
    if (now - t.at > PENDING_LOCAL_TTL_MS) return false;
    if (opts.eventTimeMs == null) return true;
    // Envelope/rumor time should be contemporary with the local send.
    return Math.abs(opts.eventTimeMs - t.at) <= BRIDGE_EVENT_WINDOW_MS;
  });
  if (idx < 0) return null;
  const [turn] = turns.splice(idx, 1);
  return turn ?? null;
}

/**
 * True when a wrap should be suppressed because a recent local fast-path
 * already owns this body (pending still listed, or recently taken/started).
 */
export function findRecentLocalTurn(
  turns: PendingLocalTurn[],
  opts: { body: string; now?: number },
): PendingLocalTurn | null {
  const body = opts.body.trim();
  if (!body) return null;
  const now = opts.now ?? Date.now();
  prunePendingLocalTurns(turns, now);
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t.body === body && now - t.at <= PENDING_LOCAL_TTL_MS) return t;
  }
  return null;
}

/** Adaptive Cloud poll cadence (P0c). */
export function nextPollIntervalMs(
  elapsedMs: number,
  fixedIntervalMs?: number,
): number {
  if (typeof fixedIntervalMs === "number" && fixedIntervalMs > 0) {
    return fixedIntervalMs;
  }
  if (elapsedMs < 15_000) return 800;
  if (elapsedMs < 45_000) return 1_500;
  return 2_500;
}
