/**
 * Arkade multi-recipient send helpers (one wallet.send → one txid).
 */
import type { NormalizedExtendedVirtualCoin } from "@arkade-os/sdk";
import type { BasicWallet } from "./hdWallet";

export const DEFAULT_MIN_VTXO_SATS = 330;
export const MAX_SEND_RECIPIENTS = 10;

/**
 * Fiat/ASP leftover carriers are exactly min vtxo or 2×min (idle sync).
 * Do NOT treat every amount ≤660 as dust — that ate real 500/501 chat pays (α74).
 */
export function isDustCarrierAmount(amountSats: number): boolean {
  const n = Math.floor(amountSats);
  return n === DEFAULT_MIN_VTXO_SATS || n === DEFAULT_MIN_VTXO_SATS * 2;
}

/** Local alias — matches Wallet.getSpendableVtxos() / SendParams.selectedVtxos. */
export type SpendableVtxo = NormalizedExtendedVirtualCoin;

export type SendRecipient = {
  address: string;
  amount: number;
  assets?: Array<{ assetId: string; amount: bigint }>;
};

export type DustSafeSendPlan = {
  amount: number;
  selectedVtxos?: SpendableVtxo[];
  amountBumped: boolean;
  originalAmount: number;
  /** Sum of all spendable vtxo values at plan time (for spend-drop baseline). */
  totalAvailable?: number;
};

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function extractSendTxid(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && "txid" in raw) {
    const t = (raw as { txid?: unknown }).txid;
    if (typeof t === "string" && t) return t;
  }
  return String(raw ?? "");
}

export async function readSpendableAvailable(
  w: {
    getSpendableVtxos?: () => Promise<Array<{ value?: number }>>;
    getBalance?: () => Promise<{ available?: number } | unknown>;
  },
  opts?: { timeoutMs?: number },
): Promise<number | null> {
  const timeoutMs = opts?.timeoutMs ?? 1_200;
  if (typeof w.getSpendableVtxos === "function") {
    try {
      const list = await withTimeout(
        w.getSpendableVtxos(),
        timeoutMs,
        "getSpendableVtxos",
      );
      let available = 0;
      for (const v of list) available += Number(v.value ?? 0);
      return available;
    } catch {
      /* fall through to getBalance — Xiaomi often times out vtxo reads (α73) */
    }
  }
  if (typeof w.getBalance === "function") {
    try {
      const raw = await withTimeout(w.getBalance(), timeoutMs, "getBalance");
      if (
        raw &&
        typeof raw === "object" &&
        typeof (raw as { available?: unknown }).available === "number"
      ) {
        return Math.floor((raw as { available: number }).available);
      }
    } catch {
      return null;
    }
  }
  return null;
}

function vtxoBatchExpiry(v: SpendableVtxo): number {
  // SDK 0.5+: batch expiry lives on expiresAt (virtualStatus removed).
  const fromDate = v.expiresAt instanceof Date ? v.expiresAt.getTime() : Number.NaN;
  if (Number.isFinite(fromDate) && fromDate > 0) return fromDate;
  return Number.MAX_SAFE_INTEGER;
}

function vtxoKey(v: SpendableVtxo): string {
  return `${v.txid ?? "?"}:${v.vout ?? "?"}`;
}

/** Mirror SDK selectVirtualCoins ordering (earlier expiry, then larger value). */
function sortSpendableLikeSdk(coins: SpendableVtxo[]): SpendableVtxo[] {
  return [...coins].sort((a, b) => {
    const expiryA = vtxoBatchExpiry(a);
    const expiryB = vtxoBatchExpiry(b);
    if (expiryA !== expiryB) return expiryA - expiryB;
    return b.value - a.value;
  });
}

export async function readMinVtxoSats(w: {
  arkProvider?: { getInfo?: () => Promise<{ dust?: bigint | number | string }> };
  dustAmount?: bigint | number;
}): Promise<number> {
  const coerce = (raw: unknown): number | null => {
    if (raw == null) return null;
    // bigint / number / numeric string → plain finite int (never leave bigint in callers)
    const n = typeof raw === "bigint" ? Number(raw) : Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.floor(n);
  };
  const fromWallet = coerce(w.dustAmount);
  if (fromWallet != null) return fromWallet;
  try {
    const info = await withTimeout(w.arkProvider?.getInfo?.() ?? Promise.reject(), 1_500, "getInfo");
    const fromInfo = coerce(info?.dust);
    if (fromInfo != null) return fromInfo;
  } catch {
    /* bundled default */
  }
  return DEFAULT_MIN_VTXO_SATS;
}

function vtxoHasAssets(v: SpendableVtxo): boolean {
  const assets = (v as { assets?: unknown }).assets;
  return Array.isArray(assets) && assets.length > 0;
}

export type PrepareDustSafeSendOpts = {
  /** Per-attempt vtxo read timeout (default 2500). Chat uses 5000. */
  timeoutMs?: number;
  /**
   * When true, never return a blind plan without selectedVtxos.
   * Blind send is what caused Xiaomi DustChangeError after ASP already settled (α73–α74).
   */
  requireVtxos?: boolean;
};

/**
 * ASP rejects change below min vtxo even when the SDK encodes it as subdust.
 * When inputs carry leftover assets, change must be ≥ dust (SDK:
 * "N sats of change cannot carry M asset change(s), needs dust").
 * `amount` is the payment sum across all recipients.
 */
export async function prepareDustSafeSend(
  w: Pick<BasicWallet, "getSpendableVtxos">,
  amount: number,
  dust: number,
  opts?: PrepareDustSafeSendOpts,
): Promise<DustSafeSendPlan> {
  const timeoutMs = opts?.timeoutMs ?? 2_500;
  const requireVtxos = !!opts?.requireVtxos;

  if (typeof w.getSpendableVtxos !== "function") {
    if (requireVtxos) {
      throw new Error(
        "Could not read spendable coins for a safe send. Wait a moment and try again.",
      );
    }
    return { amount, amountBumped: false, originalAmount: amount };
  }

  let list: SpendableVtxo[] | null = null;
  let lastErr: unknown = null;
  // One retry when first budget is short — Xiaomi often times out during ASP load.
  // Deduped so timeoutMs >= 8s stays a single attempt; classic Send uses 6s→8s.
  const attemptMs = [...new Set([timeoutMs, Math.max(timeoutMs, 8_000)])];
  for (const ms of attemptMs) {
    try {
      list = await withTimeout(w.getSpendableVtxos(), ms, "getSpendableVtxos");
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      list = null;
    }
  }

  if (!list) {
    if (requireVtxos) {
      throw new Error(
        lastErr instanceof Error
          ? `Could not read spendable coins (${lastErr.message}). Try again.`
          : "Could not read spendable coins for a safe send. Try again.",
      );
    }
    return { amount, amountBumped: false, originalAmount: amount };
  }

  const coins = list.filter((v) => Number(v.value) > 0);
  const totalAvailable = coins.reduce((s, v) => s + Number(v.value ?? 0), 0);
  if (coins.length === 0) {
    if (requireVtxos) {
      throw new Error("No spendable sats available.");
    }
    return {
      amount,
      amountBumped: false,
      originalAmount: amount,
      totalAvailable: 0,
    };
  }

  // Near-max send: leave no dust change against the whole wallet.
  let payAmount = amount;
  if (
    totalAvailable > 0 &&
    payAmount < totalAvailable &&
    totalAvailable - payAmount > 0 &&
    totalAvailable - payAmount < dust
  ) {
    payAmount = totalAvailable;
  }

  // Prefer pure-BTC coins first so sats sends avoid pulling asset change.
  const sorted = sortSpendableLikeSdk(coins);
  const preferOrder = [
    ...sorted.filter((c) => !vtxoHasAssets(c)),
    ...sorted.filter((c) => vtxoHasAssets(c)),
  ];
  const selected: SpendableVtxo[] = [];
  let selectedSum = 0;
  for (const coin of preferOrder) {
    if (selectedSum >= payAmount) break;
    selected.push(coin);
    selectedSum += coin.value;
  }
  if (selectedSum < payAmount) {
    throw new Error(
      `Insufficient sats to send (have ${selectedSum.toLocaleString("en-US")}, need ${payAmount.toLocaleString("en-US")}).`,
    );
  }

  const unused = preferOrder.filter(
    (c) => !selected.some((s) => vtxoKey(s) === vtxoKey(c)),
  );
  let change = selectedSum - payAmount;
  const needsAssetCarrier = () =>
    selected.some(vtxoHasAssets) && change < dust;

  // Subdust sats change, or 0-change with leftover assets (needs ≥dust carrier).
  for (const coin of unused) {
    if (!(change > 0 && change < dust) && !needsAssetCarrier()) break;
    selected.push(coin);
    selectedSum += coin.value;
    change = selectedSum - payAmount;
  }

  if (needsAssetCarrier()) {
    throw new Error(
      `Need about ${dust} sats of change to carry remaining assets. ` +
        `Receive a little more sats, convert a bit more, or send less.`,
    );
  }

  if (change > 0 && change < dust) {
    // Send the whole selected set — exact change-free settle (near-balance pays).
    return {
      amount: selectedSum,
      selectedVtxos: selected,
      amountBumped: true,
      originalAmount: amount,
      totalAvailable,
    };
  }

  return {
    amount: payAmount,
    selectedVtxos: selected,
    amountBumped: payAmount !== amount,
    originalAmount: amount,
    totalAvailable,
  };
}

export function formatSendError(e: unknown, dust = DEFAULT_MIN_VTXO_SATS): string {
  const msg = e instanceof Error ? e.message : String(e ?? "Unknown error");
  if (/cannot carry .+ asset change/i.test(msg)) {
    return (
      `Need about ${dust} sats of change to carry remaining assets. ` +
      `Receive a little more sats, convert a bit more, or send less.`
    );
  }
  if (
    /^Insufficient funds$/i.test(msg) ||
    /^Insufficient sats to send/i.test(msg)
  ) {
    // Keep message mode-neutral here. Callers in Fiat Mode add convert hints.
    if (/^Insufficient sats to send/i.test(msg)) return msg;
    return "Insufficient sats to send. Check your spendable balance and try again.";
  }
  if (
    /AMOUNT_TOO_LOW/i.test(msg) ||
    /min vtxo amount/i.test(msg) ||
    /DustChangeError/i.test(msg) ||
    /below dust/i.test(msg)
  ) {
    return (
      `This amount would leave change below the network minimum (${dust} sats). ` +
      `Try a slightly different amount, or send enough to spend a whole coin.`
    );
  }
  return msg;
}

/** Merge duplicate addresses (sum amounts); preserve first-seen order. */
export function mergeRecipientsByAddress(recipients: SendRecipient[]): SendRecipient[] {
  const order: string[] = [];
  const map = new Map<string, SendRecipient>();
  for (const r of recipients) {
    const addr = r.address.trim();
    if (!addr) continue;
    const prev = map.get(addr);
    if (!prev) {
      order.push(addr);
      map.set(addr, {
        address: addr,
        amount: r.amount,
        assets: r.assets ? [...r.assets] : undefined,
      });
    } else {
      prev.amount += r.amount;
      if (r.assets?.length) {
        prev.assets = [...(prev.assets ?? []), ...r.assets];
      }
    }
  }
  return order.map((address) => map.get(address)!);
}

const SEND_TIMEOUT_MS_DEFAULT = 45_000;
const TXID_GRACE_MS = 1_500;
/** Default poll — chat overrides faster (α72). */
const SPEND_POLL_MS = 2_500;
/** Default delay before spend-drop reads — chat overrides (α69 was 12s → ~10s You sent). */
const SPEND_DROP_START_MS = 12_000;

export type SendWaitResult = { txid: string; via: "send" | "spend" };

/**
 * Resolve as soon as SDK send returns *or* local spendable drops by ~total.
 * On soft timeout: one final spend check (funds often already left — α69).
 * Late SDK success still invokes onLateSuccess (chat bubble reconcile).
 * Poll stops when settled — no leaked timers.
 */
export async function waitForSendOrSpendDrop(
  w: BasicWallet,
  opts: {
    recipients: SendRecipient[];
    selectedVtxos?: SpendableVtxo[];
    prevAvailable: number | null;
    timeoutMs?: number;
    /** Delay before first spendable read (default 12s; chat uses ~2s). */
    spendDropStartMs?: number;
    /** Interval between spendable reads. */
    spendPollMs?: number;
    /** Consecutive drop hits required (chat: 1). */
    spendHitsRequired?: number;
    /** Grace wait for real txid after spend-drop (chat: short). */
    txidGraceMs?: number;
    /** Per-read timeout for spendable/balance during spend-drop. */
    spendReadTimeoutMs?: number;
    onRealTxid?: (txid: string) => void;
    /** Fired if SDK send resolves after the waiter already timed out. */
    onLateSuccess?: (r: SendWaitResult) => void;
  },
): Promise<SendWaitResult> {
  const timeoutMs = opts.timeoutMs ?? SEND_TIMEOUT_MS_DEFAULT;
  const spendDropStartMs = opts.spendDropStartMs ?? SPEND_DROP_START_MS;
  const spendPollMs = opts.spendPollMs ?? SPEND_POLL_MS;
  const spendHitsRequired = Math.max(1, opts.spendHitsRequired ?? 2);
  const txidGraceMs = opts.txidGraceMs ?? TXID_GRACE_MS;
  const spendReadTimeoutMs = opts.spendReadTimeoutMs ?? 1_200;
  const recipients = opts.recipients;
  if (recipients.length === 0) {
    throw new Error("No recipients");
  }
  const total = recipients.reduce((s, r) => s + r.amount, 0);
  const tuple = recipients as [SendRecipient, ...SendRecipient[]];
  const target =
    opts.prevAvailable != null && opts.prevAvailable > 0
      ? opts.prevAvailable - total
      : null;

  let settled = false;
  let timedOut = false;
  let resolveEarly!: (v: SendWaitResult) => void;
  let rejectEarly!: (e: unknown) => void;
  const early = new Promise<SendWaitResult>((resolve, reject) => {
    resolveEarly = resolve;
    rejectEarly = reject;
  });

  const finish = (v: SendWaitResult) => {
    if (settled) return;
    settled = true;
    resolveEarly(v);
  };

  const sendP = (
    opts.selectedVtxos && opts.selectedVtxos.length > 0
      ? w.send({ recipients: tuple, selectedVtxos: opts.selectedVtxos })
      : w.send({ recipients: tuple })
  ).then((raw) => {
    const txid = extractSendTxid(raw);
    if (timedOut && !settled) {
      console.warn("[basic] send late success after timeout", {
        txid: txid.slice(0, 16),
        amount: total,
      });
      opts.onLateSuccess?.({ txid, via: "send" });
      settled = true;
      return txid;
    }
    finish({ txid, via: "send" });
    return txid;
  });

  void sendP
    .then((txid) => {
      if (txid && !txid.startsWith("pending:")) opts.onRealTxid?.(txid);
    })
    .catch(() => {
      /* rejection handled below */
    });

  void sendP.catch((e) => {
    if (timedOut) {
      console.warn("[basic] send error after timeout", e);
      return;
    }
    if (!settled) {
      settled = true;
      rejectEarly(e);
    } else {
      console.warn("[basic] send completed with error after UI success", e);
    }
  });

  void (async () => {
    try {
      if (target == null) return;
      const deadline = Date.now() + timeoutMs;
      await sleep(spendDropStartMs);
      let hits = 0;
      let first = true;
      while (!settled && Date.now() < deadline) {
        // First read right after start delay — don't burn an extra poll interval (α72).
        if (!first) await sleep(spendPollMs);
        first = false;
        if (settled) return;
        const avail = await readSpendableAvailable(w, {
          timeoutMs: spendReadTimeoutMs,
        });
        if (avail == null) {
          console.warn("[basic] spend-drop read null (retry)", {
            timeoutMs: spendReadTimeoutMs,
          });
          continue;
        }
        if (avail <= target + 1) hits += 1;
        else hits = 0;
        if (hits < spendHitsRequired) continue;
        console.warn("[basic] send spend-drop detected", {
          prev: opts.prevAvailable,
          avail,
          amount: total,
          n: recipients.length,
          hits,
        });
        const txid = await Promise.race([
          sendP.catch(() => null),
          sleep(txidGraceMs).then(() => `pending:${Date.now()}`),
        ]);
        if (txid == null) return;
        finish({ txid, via: "spend" });
        return;
      }
    } catch (e) {
      console.warn("[basic] spend-drop watcher error", e);
    }
  })();

  try {
    return await withTimeout(early, timeoutMs, "send");
  } catch (e) {
    // Soft timeout: funds often already left while SDK promise hung (α69).
    // Xiaomi may also time out short vtxo reads — retry longer (α80).
    if (!settled && target != null) {
      for (const ms of [
        Math.max(spendReadTimeoutMs, 5_000),
        10_000,
      ]) {
        const avail = await readSpendableAvailable(w, { timeoutMs: ms });
        if (avail == null) continue;
        if (avail <= target + 1) {
          const txid = await Promise.race([
            sendP.catch(() => null),
            sleep(txidGraceMs).then(() => `pending:${Date.now()}`),
          ]);
          if (txid != null) {
            console.warn("[basic] send confirmed via spend after timeout", {
              prev: opts.prevAvailable,
              avail,
              amount: total,
              readMs: ms,
            });
            finish({ txid, via: "spend" });
            return { txid, via: "spend" };
          }
        }
        break;
      }
    }
    timedOut = true;
    throw e;
  }
}
