/**
 * Arkade multi-recipient send helpers (one wallet.send → one txid).
 */
import type { NormalizedExtendedVirtualCoin } from "@arkade-os/sdk";
import type { BasicWallet } from "./hdWallet";

export const DEFAULT_MIN_VTXO_SATS = 330;
export const MAX_SEND_RECIPIENTS = 10;

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

export async function readSpendableAvailable(w: {
  getSpendableVtxos?: () => Promise<Array<{ value?: number }>>;
}): Promise<number | null> {
  if (typeof w.getSpendableVtxos !== "function") return null;
  try {
    const list = await withTimeout(w.getSpendableVtxos(), 1_200, "getSpendableVtxos");
    let available = 0;
    for (const v of list) available += Number(v.value ?? 0);
    return available;
  } catch {
    return null;
  }
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
  const fromWallet = w.dustAmount;
  if (fromWallet != null) {
    const n = Number(fromWallet);
    if (Number.isFinite(n) && n > 0) return n;
  }
  try {
    const info = await withTimeout(w.arkProvider?.getInfo?.() ?? Promise.reject(), 1_500, "getInfo");
    const n = Number(info?.dust);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* bundled default */
  }
  return DEFAULT_MIN_VTXO_SATS;
}

function vtxoHasAssets(v: SpendableVtxo): boolean {
  const assets = (v as { assets?: unknown }).assets;
  return Array.isArray(assets) && assets.length > 0;
}

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
): Promise<DustSafeSendPlan> {
  if (typeof w.getSpendableVtxos !== "function") {
    return { amount, amountBumped: false, originalAmount: amount };
  }
  let list: SpendableVtxo[];
  try {
    list = await withTimeout(w.getSpendableVtxos(), 2_500, "getSpendableVtxos");
  } catch {
    return { amount, amountBumped: false, originalAmount: amount };
  }
  const coins = list.filter((v) => Number(v.value) > 0);
  if (coins.length === 0) {
    return { amount, amountBumped: false, originalAmount: amount };
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
    if (selectedSum >= amount) break;
    selected.push(coin);
    selectedSum += coin.value;
  }
  if (selectedSum < amount) {
    throw new Error("Insufficient funds");
  }

  const unused = preferOrder.filter(
    (c) => !selected.some((s) => vtxoKey(s) === vtxoKey(c)),
  );
  let change = selectedSum - amount;
  const needsAssetCarrier = () =>
    selected.some(vtxoHasAssets) && change < dust;

  // Subdust sats change, or 0-change with leftover assets (needs ≥dust carrier).
  for (const coin of unused) {
    if (!(change > 0 && change < dust) && !needsAssetCarrier()) break;
    selected.push(coin);
    selectedSum += coin.value;
    change = selectedSum - amount;
  }

  if (needsAssetCarrier()) {
    throw new Error(
      `Need about ${dust} sats of change to carry remaining assets. ` +
        `Receive a little more sats, convert a bit more, or send less.`,
    );
  }

  if (change > 0 && change < dust) {
    return {
      amount: selectedSum,
      selectedVtxos: selected,
      amountBumped: true,
      originalAmount: amount,
    };
  }

  return {
    amount,
    selectedVtxos: selected,
    amountBumped: false,
    originalAmount: amount,
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
const SPEND_POLL_MS = 350;

/**
 * Resolve as soon as SDK send returns *or* local spendable drops by ~total.
 * Poll stops when settled — no leaked timers.
 */
export async function waitForSendOrSpendDrop(
  w: BasicWallet,
  opts: {
    recipients: SendRecipient[];
    selectedVtxos?: SpendableVtxo[];
    prevAvailable: number | null;
    timeoutMs?: number;
    onRealTxid?: (txid: string) => void;
  },
): Promise<{ txid: string; via: "send" | "spend" }> {
  const timeoutMs = opts.timeoutMs ?? SEND_TIMEOUT_MS_DEFAULT;
  const recipients = opts.recipients;
  if (recipients.length === 0) {
    throw new Error("No recipients");
  }
  const total = recipients.reduce((s, r) => s + r.amount, 0);
  const tuple = recipients as [SendRecipient, ...SendRecipient[]];

  let settled = false;
  let resolveEarly!: (v: { txid: string; via: "send" | "spend" }) => void;
  let rejectEarly!: (e: unknown) => void;
  const early = new Promise<{ txid: string; via: "send" | "spend" }>((resolve, reject) => {
    resolveEarly = resolve;
    rejectEarly = reject;
  });

  const finish = (v: { txid: string; via: "send" | "spend" }) => {
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
    finish({ txid, via: "send" });
    return txid;
  });

  void sendP
    .then((txid) => {
      if (txid) opts.onRealTxid?.(txid);
    })
    .catch(() => {
      /* rejection handled below */
    });

  void sendP.catch((e) => {
    if (!settled) {
      settled = true;
      rejectEarly(e);
    } else {
      console.warn("[basic] send completed with error after UI success", e);
    }
  });

  void (async () => {
    try {
      if (opts.prevAvailable == null || !(opts.prevAvailable > 0)) return;
      const target = opts.prevAvailable - total;
      const deadline = Date.now() + timeoutMs;
      let hits = 0;
      while (!settled && Date.now() < deadline) {
        await sleep(SPEND_POLL_MS);
        if (settled) return;
        const avail = await readSpendableAvailable(w);
        if (avail == null) continue;
        if (avail <= target + 1) hits += 1;
        else hits = 0;
        if (hits < 2) continue;
        console.warn("[basic] send spend-drop detected", {
          prev: opts.prevAvailable,
          avail,
          amount: total,
          n: recipients.length,
        });
        const txid = await Promise.race([
          sendP.catch(() => null),
          sleep(TXID_GRACE_MS).then(() => `pending:${Date.now()}`),
        ]);
        if (txid == null) return;
        finish({ txid, via: "spend" });
        return;
      }
    } catch (e) {
      console.warn("[basic] spend-drop watcher error", e);
    }
  })();

  return withTimeout(early, timeoutMs, "send");
}
