/**
 * Credit Home when chat shows an inbound payment, without waiting for ASP notify.
 *
 * α76 kept receipt from double-adding when notify already applied. On devices
 * where notify/push is dead (or getBalance stays 0), chat could show
 * "You received" while Home stayed at 0. Receipt path now ensures one Home
 * credit; notify path notes the same window so it does not double-apply.
 */

type CreditHint = { amountSats: number; at: number };

const CREDIT_TTL_MS = 3 * 60_000;
const recentCredits: CreditHint[] = [];

type HomeCreditHook = (amountSats: number) => void;
let homeCreditHook: HomeCreditHook | null = null;

function prune(now = Date.now()): void {
  for (let i = recentCredits.length - 1; i >= 0; i--) {
    if (now - recentCredits[i].at > CREDIT_TTL_MS) {
      recentCredits.splice(i, 1);
    }
  }
}

export function registerChatInboundHomeCreditHook(
  hook: HomeCreditHook | null,
): void {
  homeCreditHook = hook;
}

/** Notify (or other) already credited Home for this amount — receipt must skip. */
export function noteChatInboundHomeCredited(amountSats: number): void {
  const abs = Math.abs(Math.floor(amountSats));
  if (!(abs > 0)) return;
  prune();
  recentCredits.push({ amountSats: abs, at: Date.now() });
}

export function wasChatInboundHomeCredited(
  amountSats: number,
  newerThanMs = CREDIT_TTL_MS,
): boolean {
  prune();
  const abs = Math.abs(Math.floor(amountSats));
  if (!(abs > 0)) return false;
  const since = Date.now() - Math.max(0, newerThanMs);
  for (let i = recentCredits.length - 1; i >= 0; i--) {
    const h = recentCredits[i];
    if (h.at < since) continue;
    if (Math.abs(h.amountSats - abs) <= 1) return true;
  }
  return false;
}

/**
 * Ensure Home reflects an inbound chat payment once.
 * Returns true when the hook ran (new credit).
 */
export function ensureChatInboundHomeCredit(amountSats: number): boolean {
  const abs = Math.abs(Math.floor(amountSats));
  if (!(abs > 0)) return false;
  if (wasChatInboundHomeCredited(abs)) return false;
  noteChatInboundHomeCredited(abs);
  if (!homeCreditHook) {
    console.warn("[basic] chat inbound home credit skipped (no hook)", abs);
    return false;
  }
  try {
    homeCreditHook(abs);
    console.warn("[basic] chat inbound home credit", { amount: abs });
    return true;
  } catch (e) {
    console.warn("[basic] chat inbound home credit failed", e);
    return false;
  }
}
