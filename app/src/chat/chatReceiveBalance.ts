/**
 * Apply inbound chat pay to Home balance at most once per payment.
 * Covers Ark notify and NIP-17 receipt so neither path double-counts or skips (α75).
 */

type ApplyFn = (amountSats: number) => void;

type Hooks = {
  applyLocalReceive: ApplyFn;
  pullLiveBalance?: () => void;
};

let hooks: Hooks | null = null;

const applied = new Map<string, number>();
const TTL_PID_MS = 10 * 60_000;
/** Short window so two real same-amount pays minutes apart both apply. */
const TTL_AMT_MS = 45_000;

export function registerChatReceiveBalanceHooks(next: Hooks | null): void {
  hooks = next;
}

function prune(now = Date.now()): void {
  for (const [k, at] of applied) {
    const ttl = k.startsWith("pid:") ? TTL_PID_MS : TTL_AMT_MS;
    if (now - at > ttl) applied.delete(k);
  }
}

function keysFor(opts: {
  paymentId?: string | null;
  contactId?: string | null;
  amountSats: number;
}): string[] {
  const abs = Math.floor(opts.amountSats);
  const out: string[] = [];
  const pid = opts.paymentId?.trim();
  if (pid) out.push(`pid:${pid}`);
  // Contact-agnostic amount key bridges notify (no contact yet) ↔ receipt.
  out.push(`amt:*:${abs}`);
  const c = opts.contactId?.trim();
  if (c) out.push(`amt:${c}:${abs}`);
  return out;
}

/** Mark that notify (or another path) already floored Home for this pay. */
export function noteChatReceiveApplied(opts: {
  amountSats: number;
  paymentId?: string | null;
  contactId?: string | null;
}): void {
  const abs = Math.floor(opts.amountSats);
  if (!(abs > 0)) return;
  prune();
  const now = Date.now();
  for (const k of keysFor({ ...opts, amountSats: abs })) {
    applied.set(k, now);
  }
}

/**
 * @returns true if balance was applied now (caller may still refresh live ASP).
 */
export function applyChatReceiveBalanceOnce(
  opts: {
    amountSats: number;
    paymentId?: string | null;
    contactId?: string | null;
  },
  applyLocalReceive?: ApplyFn,
): boolean {
  const abs = Math.floor(opts.amountSats);
  if (!(abs > 0)) return false;
  prune();
  const keys = keysFor({ ...opts, amountSats: abs });
  if (keys.some((k) => applied.has(k))) return false;
  const now = Date.now();
  for (const k of keys) applied.set(k, now);

  const apply = applyLocalReceive ?? hooks?.applyLocalReceive;
  if (!apply) {
    console.warn("[basic] chat receive balance: no apply hook", {
      amount: abs,
    });
    return false;
  }
  apply(abs);
  hooks?.pullLiveBalance?.();
  console.warn("[basic] chat receive balance applied once", {
    amount: abs,
    keys: keys.map((k) => k.slice(0, 40)),
  });
  return true;
}
