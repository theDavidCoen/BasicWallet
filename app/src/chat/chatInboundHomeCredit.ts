/**
 * Inbound chat receipt ↔ Home balance coordination.
 *
 * rc.9 briefly applied applyLocalReceive from the Nostr receipt. That painted
 * Home while ASP getSpendableVtxos stayed empty (Samsung: You received +
 * "No spendable sats"). Receipt is not settlement proof — only ASP notify /
 * live getBalance may credit Home. This module still:
 * - notes amounts so notify/receipt races do not double-apply
 * - persists those notes so empty-live heal survives process death / RC install
 * - asks WalletProvider to refresh / boost watch (no phantom credit)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { isHomeTourUiOpen } from "../home/homeTour";

type CreditHint = { amountSats: number; at: number };

const CREDIT_TTL_MS = 3 * 60_000;
/** Heal window after RC upgrade / cold start (rc.9 phantom ack on disk). */
const PERSIST_HEAL_TTL_MS = 7 * 24 * 60 * 60_000;
const STORAGE_KEY = "basic.chat.inboundHomeCredits.v1";

const recentCredits: CreditHint[] = [];
let persistLoaded = false;
let persistLoadPromise: Promise<void> | null = null;

function prune(now = Date.now()): void {
  for (let i = recentCredits.length - 1; i >= 0; i--) {
    if (now - recentCredits[i].at > PERSIST_HEAL_TTL_MS) {
      recentCredits.splice(i, 1);
    }
  }
}

async function loadPersisted(): Promise<void> {
  if (persistLoaded) return;
  if (persistLoadPromise) return persistLoadPromise;
  persistLoadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CreditHint[];
        if (Array.isArray(parsed)) {
          const now = Date.now();
          for (const h of parsed) {
            if (
              typeof h?.amountSats === "number" &&
              typeof h?.at === "number" &&
              now - h.at <= PERSIST_HEAL_TTL_MS
            ) {
              recentCredits.push(h);
            }
          }
        }
      }
    } catch {
      /* ignore */
    } finally {
      persistLoaded = true;
      persistLoadPromise = null;
    }
  })();
  return persistLoadPromise;
}

function schedulePersist(): void {
  prune();
  const payload = recentCredits
    .filter((h) => Date.now() - h.at <= PERSIST_HEAL_TTL_MS)
    .slice(-40);
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload)).catch(() => {});
}

/** Call early (WalletProvider mount) so heal sees rc.9 notes after restart. */
export function warmChatInboundHomeCreditNotes(): void {
  void loadPersisted();
}

/** Refresh/boost only — must not applyLocalReceive (phantom Home). */
type HomeCreditHook = (amountSats: number) => void;
let homeCreditHook: HomeCreditHook | null = null;

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
  schedulePersist();
  // Ensure disk load does not wipe a note written before warm completes.
  void loadPersisted().then(() => {
    prune();
    if (!wasChatInboundHomeCredited(abs, PERSIST_HEAL_TTL_MS)) {
      recentCredits.push({ amountSats: abs, at: Date.now() });
    }
    schedulePersist();
  });
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

/** Clear a noted amount after empty-live heal zeros the phantom ack. */
export function clearChatInboundHomeCreditNote(amountSats: number): void {
  const abs = Math.abs(Math.floor(amountSats));
  if (!(abs > 0)) return;
  for (let i = recentCredits.length - 1; i >= 0; i--) {
    if (Math.abs(recentCredits[i].amountSats - abs) <= 1) {
      recentCredits.splice(i, 1);
    }
  }
  schedulePersist();
}

/**
 * After an inbound chat receipt: note the amount (notify dedupe) and refresh
 * ASP balance. Does not invent spendable sats.
 * Returns true when the refresh hook ran.
 */
export function ensureChatInboundHomeCredit(amountSats: number): boolean {
  const abs = Math.abs(Math.floor(amountSats));
  if (!(abs > 0)) return false;
  // Note for post-tour dedupe, but do not run Home refresh / toast storms
  // while Spotlight D owns the JS thread (Samsung passkey→tour freeze).
  if (isHomeTourUiOpen()) {
    if (!wasChatInboundHomeCredited(abs)) noteChatInboundHomeCredited(abs);
    console.warn(
      "[basic] chat inbound home refresh deferred (home tour open)",
      abs,
    );
    return false;
  }
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
