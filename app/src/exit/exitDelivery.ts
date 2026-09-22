/**
 * Measure onchain sats paid to the recovery address from exit sweep txs.
 */

import type { ExecutorEvent } from "@arkade-os/sdk";

function looksLikeTxid(raw: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(raw.trim());
}

/** Unique sweep txids that reached broadcast/confirmed. */
export function sweepTxidsFromEvents(events: ExecutorEvent[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of events) {
    if (e.kind !== "sweep") continue;
    if (e.status !== "broadcast" && e.status !== "confirmed") continue;
    const id = (e.txid ?? "").trim();
    if (!looksLikeTxid(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Sum outputs to `sweepAddress` across the given txids (Esplora). */
export async function sumDeliveredToAddress(opts: {
  esploraUrl: string;
  sweepAddress: string;
  txids: string[];
}): Promise<number> {
  const base = opts.esploraUrl.replace(/\/$/, "");
  const addr = opts.sweepAddress.trim();
  if (!addr || opts.txids.length === 0) return 0;
  let total = 0;
  for (const txid of opts.txids) {
    try {
      const res = await fetch(`${base}/tx/${txid}`);
      if (!res.ok) continue;
      const tx = (await res.json()) as {
        vout?: { scriptpubkey_address?: string; value?: number }[];
      };
      total += (tx.vout ?? [])
        .filter((o) => o.scriptpubkey_address === addr)
        .reduce((s, o) => s + (o.value ?? 0), 0);
    } catch {
      /* skip */
    }
  }
  return total;
}

/**
 * Find a confirmed payment to `sweepAddress` whose value is near `targetSats`
 * (fee slack). Used when an exit activity row was wrongly linked to another
 * package's sweep txid.
 */
export async function findRecoveryPaymentNearAmount(opts: {
  esploraUrl: string;
  sweepAddress: string;
  targetSats: number;
  /** Prefer this txid when it already matches. */
  preferTxid?: string;
}): Promise<{ txid: string; paid: number } | null> {
  const base = opts.esploraUrl.replace(/\/$/, "");
  const addr = opts.sweepAddress.trim();
  const target = Math.max(0, Math.floor(opts.targetSats));
  if (!addr || target <= 0) return null;

  const slack = Math.max(2_000, Math.floor(target * 0.05));

  if (opts.preferTxid && looksLikeTxid(opts.preferTxid)) {
    const paid = await sumDeliveredToAddress({
      esploraUrl: base,
      sweepAddress: addr,
      txids: [opts.preferTxid],
    });
    if (paid > 0 && Math.abs(paid - target) <= slack) {
      return { txid: opts.preferTxid.trim(), paid };
    }
  }

  try {
    const res = await fetch(`${base}/address/${addr}/txs`);
    if (!res.ok) return null;
    const txs = (await res.json()) as {
      txid: string;
      status?: { confirmed?: boolean };
      vout?: { scriptpubkey_address?: string; value?: number }[];
    }[];
    let best: { txid: string; paid: number; dist: number } | null = null;
    for (const t of txs) {
      if (t.status && t.status.confirmed === false) continue;
      const paid = (t.vout ?? [])
        .filter((o) => o.scriptpubkey_address === addr)
        .reduce((s, o) => s + (o.value ?? 0), 0);
      if (paid <= 0) continue;
      const dist = Math.abs(paid - target);
      if (dist > slack) continue;
      if (!best || dist < best.dist) {
        best = { txid: t.txid, paid, dist };
      }
    }
    return best ? { txid: best.txid, paid: best.paid } : null;
  } catch {
    return null;
  }
}
