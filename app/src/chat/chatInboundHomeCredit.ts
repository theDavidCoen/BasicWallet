/**
 * Inbound chat receipt ↔ Home balance coordination.
 *
 * rc.9 briefly applied applyLocalReceive from the Nostr receipt. That painted
 * Home while ASP getSpendableVtxos stayed empty (Samsung: You received +
 * "No spendable sats"). Receipt is not settlement proof — only ASP notify /
 * live getBalance may credit Home. This module still:
 * - notes amounts so notify/receipt races do not double-apply
 * - asks WalletProvider to refresh / boost watch (no phantom credit)
 */

type CreditHint = { amountSats: number; at: number };

const CREDIT_TTL_MS = 3 * 60_000;
const recentCredits: CreditHint[] = [];

/** Refresh/boost only — must not applyLocalReceive (phantom Home). */
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
 * After an inbound chat receipt: note the amount (notify dedupe) and refresh
 * ASP balance. Does not invent spendable sats.
 * Returns true when the refresh hook ran.
 */
export function ensureChatInboundHomeCredit(amountSats: number): boolean {
  const abs = Math.abs(Math.floor(amountSats));
  if (!(abs > 0)) return false;
  const already = wasChatInboundHomeCredited(abs);
  if (!already) noteChatInboundHomeCredited(abs);
  if (!homeCreditHook) {
    console.warn("[basic] chat inbound home refresh skipped (no hook)", abs);
    return false;
  }
  try {
    homeCreditHook(abs);
    console.warn("[basic] chat inbound home refresh", {
      amount: abs,
      noted: !already,
    });
    return true;
  } catch (e) {
    console.warn("[basic] chat inbound home refresh failed", e);
    return false;
  }
}
