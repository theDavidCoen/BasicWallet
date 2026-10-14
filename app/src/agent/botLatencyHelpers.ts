/**
 * Pure helpers for Ask Cursor latency P0 (fast-path id, ack match, local→wrap bridge).
 * Kept free of RN/AsyncStorage so unit tests can run under plain tsx.
 */

export const BOT_WORKING_ACK = "Working on it…";

const PENDING_LOCAL_TTL_MS = 120_000;
const BRIDGE_WINDOW_MS = 90_000;

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
 * @returns the matched turn (removed from `turns`), or null.
 */
export function takePendingLocalTurn(
  turns: PendingLocalTurn[],
  opts: { body: string; wrapCreatedAtSec?: number; now?: number },
): PendingLocalTurn | null {
  const body = opts.body.trim();
  if (!body) return null;
  prunePendingLocalTurns(turns, opts.now);
  const idx = turns.findIndex((t) => {
    if (t.body !== body) return false;
    if (opts.wrapCreatedAtSec == null) return true;
    const wrapMs = opts.wrapCreatedAtSec * 1000;
    return Math.abs(wrapMs - t.at) <= BRIDGE_WINDOW_MS;
  });
  if (idx < 0) return null;
  const [turn] = turns.splice(idx, 1);
  return turn ?? null;
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
