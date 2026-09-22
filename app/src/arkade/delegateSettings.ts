/**
 * Arkade VTXO delegate preferences.
 * Default: enabled with Arkade's network default delegator URL.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ArkadeNetworkId } from "../config/network";

const KEY = "basic.wallet.delegate.v1";

/** Official Arkade defaults (same hosts as arkade.money). */
export const DEFAULT_DELEGATE_URL: Record<ArkadeNetworkId, string> = {
  mutinynet: "https://delegator.mutinynet.arkade.sh",
  mainnet: "https://delegate.arkade.money",
};

export type DelegateSettings = {
  /** When true, Wallet.create gets a RestDelegateProvider. Default on. */
  enabled: boolean;
  /** Use Arkade default URL for the active network, or a custom host. */
  useDefault: boolean;
  /** Custom base URL (https://…), used when useDefault is false. */
  customUrl: string;
};

const DEFAULTS: DelegateSettings = {
  enabled: true,
  useDefault: true,
  customUrl: "",
};

export async function readDelegateSettings(): Promise<DelegateSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<DelegateSettings>;
    return {
      enabled: parsed.enabled !== false,
      useDefault: parsed.useDefault !== false,
      customUrl: typeof parsed.customUrl === "string" ? parsed.customUrl : "",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeDelegateSettings(next: DelegateSettings): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
}

export async function patchDelegateSettings(
  patch: Partial<DelegateSettings>,
): Promise<DelegateSettings> {
  const cur = await readDelegateSettings();
  const next = { ...cur, ...patch };
  await writeDelegateSettings(next);
  return next;
}

/** Normalize host → https://… without trailing slash. */
export function normalizeDelegateUrl(raw: string): string | null {
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) return null;
  const withScheme =
    /^https?:\/\//i.test(t)
      ? t
      : t.startsWith("localhost") || t.startsWith("127.0.0.1")
        ? `http://${t}`
        : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Effective delegator base URL for Wallet.create, or null when disabled. */
export function resolveDelegateUrl(
  networkId: ArkadeNetworkId,
  settings: DelegateSettings,
): string | null {
  if (!settings.enabled) return null;
  if (settings.useDefault) return DEFAULT_DELEGATE_URL[networkId];
  return normalizeDelegateUrl(settings.customUrl);
}

export async function probeDelegateInfo(
  baseUrl: string,
): Promise<{ fee: number; pubkey: string; address: string }> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/delegator/info`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Delegate HTTP ${res.status}`);
  const data = (await res.json()) as {
    fee?: string;
    pubkey?: string;
    delegatorAddress?: string;
  };
  const fee = parseInt(data.fee ?? "", 10);
  if (!Number.isFinite(fee) || fee < 0) throw new Error("Invalid delegate fee");
  if (!data.pubkey || data.pubkey.length !== 66) throw new Error("Invalid delegate pubkey");
  if (!data.delegatorAddress?.trim()) throw new Error("Missing delegate address");
  return {
    fee,
    pubkey: data.pubkey,
    address: data.delegatorAddress.trim(),
  };
}
