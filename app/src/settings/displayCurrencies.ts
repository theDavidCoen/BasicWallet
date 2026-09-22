/**
 * Home display-currency toggles (Penpot 05b).
 * Default: USD + EUR under the sats balance.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "basic.wallet.displayCurrencies.v1";

export const DISPLAY_CURRENCY_CODES = ["EUR", "USD", "GBP", "JPY"] as const;
export type DisplayCurrencyCode = (typeof DISPLAY_CURRENCY_CODES)[number];

export type DisplayCurrencySettings = {
  /** Codes shown under Home balance, in DISPLAY_CURRENCY_CODES order. */
  enabled: DisplayCurrencyCode[];
};

const DEFAULTS: DisplayCurrencySettings = {
  enabled: ["EUR", "USD"],
};

function sanitize(list: unknown): DisplayCurrencyCode[] {
  if (!Array.isArray(list)) return [...DEFAULTS.enabled];
  const out: DisplayCurrencyCode[] = [];
  for (const code of DISPLAY_CURRENCY_CODES) {
    if (list.includes(code)) out.push(code);
  }
  return out.length > 0 ? out : [...DEFAULTS.enabled];
}

export async function readDisplayCurrencies(): Promise<DisplayCurrencySettings> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return { enabled: [...DEFAULTS.enabled] };
    const parsed = JSON.parse(raw) as Partial<DisplayCurrencySettings>;
    return { enabled: sanitize(parsed.enabled) };
  } catch {
    return { enabled: [...DEFAULTS.enabled] };
  }
}

export async function writeDisplayCurrencies(
  next: DisplayCurrencySettings,
): Promise<void> {
  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({ enabled: sanitize(next.enabled) }),
  );
}

export async function setDisplayCurrencyEnabled(
  code: DisplayCurrencyCode,
  on: boolean,
): Promise<DisplayCurrencySettings> {
  const cur = await readDisplayCurrencies();
  const set = new Set(cur.enabled);
  if (on) set.add(code);
  else set.delete(code);
  const next = { enabled: sanitize([...set]) };
  // Keep at least one currency so Home still has a fiat line.
  if (next.enabled.length === 0) next.enabled = [code];
  await writeDisplayCurrencies(next);
  return next;
}

/** Spot BTC→fiat via CoinGecko (same source as fiatRate cache). */
export const SPOT_RATE_TTL_MS = 60_000;

type SpotCache = {
  key: string;
  fetchedAt: number;
  rates: Partial<Record<DisplayCurrencyCode, number>>;
};

let spotCache: SpotCache | null = null;
let spotInflight: Promise<Partial<Record<DisplayCurrencyCode, number>>> | null =
  null;

function spotKey(codes: DisplayCurrencyCode[]): string {
  return [...codes].sort().join(",");
}

export async function fetchSpotRates(
  codes: DisplayCurrencyCode[],
  opts?: { force?: boolean },
): Promise<Partial<Record<DisplayCurrencyCode, number>>> {
  if (codes.length === 0) return {};
  const key = spotKey(codes);
  const now = Date.now();
  if (
    !opts?.force &&
    spotCache &&
    spotCache.key === key &&
    now - spotCache.fetchedAt < SPOT_RATE_TTL_MS
  ) {
    return spotCache.rates;
  }
  if (spotInflight) return spotInflight;

  const vs = codes.map((c) => c.toLowerCase()).join(",");
  spotInflight = (async () => {
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${encodeURIComponent(vs)}`;
      const res = await fetch(url);
      if (res.status === 429) {
        // Keep last good rates; do not stamp a fresh TTL so the next tick can retry.
        return spotCache?.key === key ? spotCache.rates : {};
      }
      if (!res.ok) {
        return spotCache?.key === key ? spotCache.rates : {};
      }
      const json = (await res.json()) as { bitcoin?: Record<string, number> };
      const btc = json.bitcoin ?? {};
      const out: Partial<Record<DisplayCurrencyCode, number>> = {};
      for (const code of codes) {
        const rate = btc[code.toLowerCase()];
        if (typeof rate === "number" && Number.isFinite(rate)) out[code] = rate;
      }
      if (Object.keys(out).length > 0) {
        spotCache = { key, fetchedAt: Date.now(), rates: out };
      }
      return Object.keys(out).length > 0
        ? out
        : spotCache?.key === key
          ? spotCache.rates
          : {};
    } catch {
      return spotCache?.key === key ? spotCache.rates : {};
    } finally {
      spotInflight = null;
    }
  })();

  return spotInflight;
}

export function formatHomeFiatLine(
  sats: number,
  codes: DisplayCurrencyCode[],
  rates: Partial<Record<DisplayCurrencyCode, number>>,
): string | null {
  const parts: string[] = [];
  for (const code of codes) {
    const part = formatHomeFiatAmount(sats, code, rates);
    if (part) parts.push(part);
  }
  return parts.length > 0 ? parts.join(" / ") : null;
}

/** Single fiat amount for Home primary balance (e.g. `EUR 12.34`). */
export function formatHomeFiatAmount(
  sats: number,
  code: DisplayCurrencyCode,
  rates: Partial<Record<DisplayCurrencyCode, number>>,
  opts?: { hidden?: boolean },
): string | null {
  if (opts?.hidden) return `****** ${code}`;
  const rate = rates[code];
  if (rate == null) return null;
  const fiat = (sats / 100_000_000) * rate;
  const digits = code === "JPY" ? 0 : fiat >= 1000 ? 0 : 2;
  return `${code} ${fiat.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** Footer spot rates, Penpot Home: `BTC/USD 64,920   ·   BTC/EUR 60,190`. */
export function formatBtcRateFooter(
  codes: DisplayCurrencyCode[],
  rates: Partial<Record<DisplayCurrencyCode, number>>,
): string | null {
  const prefer: DisplayCurrencyCode[] = ["USD", "EUR", "GBP", "JPY"];
  const ordered = prefer.filter((c) => codes.includes(c));
  const parts: string[] = [];
  for (const code of ordered) {
    const rate = rates[code];
    if (rate == null) continue;
    parts.push(`BTC/${code} ${Math.round(rate).toLocaleString("en-US")}`);
  }
  return parts.length > 0 ? parts.join("   ·   ") : null;
}
