/**
 * Minimal LND REST client (payments / balance only — no channel management).
 * Auth: Grpc-Metadata-macaroon: <hex>
 */

import type { LndRestConfig } from "./btcpayConfig";

export type LndGetInfo = {
  alias?: string;
  identity_pubkey?: string;
  synced_to_chain?: boolean;
  synced_to_graph?: boolean;
  num_active_channels?: number;
  block_height?: number;
  version?: string;
};

export type LndChannelBalance = {
  /** Local channel balance in sats. */
  localSats: number;
  remoteSats: number;
  pendingOpenLocalSats: number;
};

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

async function lndFetch<T>(
  cfg: LndRestConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = joinUrl(cfg.restUrl, path);
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Grpc-Metadata-macaroon": cfg.macaroonHex,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* */
    }
    throw new Error(
      detail
        ? `LND REST ${res.status}: ${detail}`
        : `LND REST request failed (${res.status})`,
    );
  }

  return (await res.json()) as T;
}

export async function lndGetInfo(cfg: LndRestConfig): Promise<LndGetInfo> {
  return lndFetch<LndGetInfo>(cfg, "/v1/getinfo");
}

function amountSats(field: unknown): number {
  if (field == null) return 0;
  if (typeof field === "number" && Number.isFinite(field)) return Math.floor(field);
  if (typeof field === "string" && field.trim()) {
    const n = Number.parseInt(field, 10);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof field === "object") {
    const o = field as { sat?: string | number; msat?: string | number };
    if (o.sat != null) return amountSats(o.sat);
    if (o.msat != null) return Math.floor(amountSats(o.msat) / 1000);
  }
  return 0;
}

export async function lndChannelBalance(cfg: LndRestConfig): Promise<LndChannelBalance> {
  const raw = await lndFetch<{
    balance?: string;
    local_balance?: unknown;
    remote_balance?: unknown;
    pending_open_local_balance?: unknown;
  }>(cfg, "/v1/balance/channels");

  const localSats =
    amountSats(raw.local_balance) || amountSats(raw.balance);
  return {
    localSats,
    remoteSats: amountSats(raw.remote_balance),
    pendingOpenLocalSats: amountSats(raw.pending_open_local_balance),
  };
}

/** Probe credentials: getinfo + channel balance. */
export async function probeLndRest(cfg: LndRestConfig): Promise<{
  info: LndGetInfo;
  balance: LndChannelBalance;
}> {
  const info = await lndGetInfo(cfg);
  const balance = await lndChannelBalance(cfg);
  return { info, balance };
}
