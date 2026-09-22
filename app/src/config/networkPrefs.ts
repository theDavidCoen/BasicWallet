/**
 * Network selection + optional custom ASP URL (per network).
 * Defaults: mainnet + official arkade.computer / mutinynet.arkade.sh.
 * Applied on boot; changing network requires confirm + app reload.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type ArkadeNetworkId,
  type NetworkConfig,
  NETWORK_DEFAULTS,
} from "./networkDefaults";

const PREFS_KEY = "basic.wallet.network.v1";

export type NetworkPrefs = {
  networkId: ArkadeNetworkId;
  /** Custom ASP base URL per network; omit/empty → official default. */
  customArkServer: Partial<Record<ArkadeNetworkId, string>>;
};

const DEFAULT_PREFS: NetworkPrefs = {
  networkId: "mainnet",
  customArkServer: {},
};

let cachedPrefs: NetworkPrefs = { ...DEFAULT_PREFS, customArkServer: {} };
let loaded = false;

export function isNetworkPrefsLoaded(): boolean {
  return loaded;
}

export function getNetworkPrefs(): NetworkPrefs {
  return {
    networkId: cachedPrefs.networkId,
    customArkServer: { ...cachedPrefs.customArkServer },
  };
}

export async function loadNetworkPreferences(): Promise<NetworkPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NetworkPrefs>;
      const id =
        parsed.networkId === "mutinynet" || parsed.networkId === "mainnet"
          ? parsed.networkId
          : DEFAULT_PREFS.networkId;
      const custom: Partial<Record<ArkadeNetworkId, string>> = {};
      if (parsed.customArkServer && typeof parsed.customArkServer === "object") {
        for (const k of ["mainnet", "mutinynet"] as const) {
          const v = parsed.customArkServer[k];
          if (typeof v === "string" && v.trim()) custom[k] = v.trim().replace(/\/+$/, "");
        }
      }
      cachedPrefs = { networkId: id, customArkServer: custom };
    } else {
      cachedPrefs = { ...DEFAULT_PREFS, customArkServer: {} };
    }
  } catch {
    cachedPrefs = { ...DEFAULT_PREFS, customArkServer: {} };
  }
  loaded = true;
  return getNetworkPrefs();
}

export async function writeNetworkPrefs(next: NetworkPrefs): Promise<void> {
  cachedPrefs = {
    networkId: next.networkId,
    customArkServer: { ...next.customArkServer },
  };
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(cachedPrefs));
  loaded = true;
}

/** Normalize ASP host → https://… without trailing slash. */
export function normalizeArkServerUrl(raw: string): string | null {
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

export function resolveNetworkConfig(prefs: NetworkPrefs = cachedPrefs): NetworkConfig {
  const base = NETWORK_DEFAULTS[prefs.networkId];
  const custom = prefs.customArkServer[prefs.networkId]?.trim();
  return {
    ...base,
    arkServerUrl: custom && custom.length > 0 ? custom.replace(/\/+$/, "") : base.arkServerUrl,
  };
}

export function defaultArkServerUrl(networkId: ArkadeNetworkId): string {
  return NETWORK_DEFAULTS[networkId].arkServerUrl;
}
