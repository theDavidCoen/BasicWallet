/**
 * BTCPay → Services → LND (REST) config parsing.
 *
 * Supported inputs:
 * 1. `config=https://…/lnd.config` — fetch JSON, take first `lnd-rest` configuration
 * 2. Inline `type=lnd-rest;server=https://…;macaroon=HEX…` (optional certthumbprint / allowinsecure)
 * 3. Raw JSON blob with `configurations[]` (paste of the config file body)
 */

export type LndRestConfig = {
  /** Full REST base URL, e.g. https://btcpay.example.com:8080 or https://host/lnd-rest */
  restUrl: string;
  /** Hex-encoded macaroon (admin or invoice+payments). */
  macaroonHex: string;
  /** Optional TLS cert thumbprint from BTCPay (informational; RN uses system trust). */
  certThumbprint?: string;
  allowInsecure?: boolean;
  source: "btcpay-config-url" | "lnd-rest-string" | "btcpay-json";
};

export type BtcPayConfigJson = {
  configurations?: Array<{
    type?: string;
    uri?: string;
    adminMacaroon?: string;
    macaroon?: string;
  }>;
};

function normalizeRestUrl(uri: string): string {
  const t = uri.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/.+/i.test(t)) {
    throw new Error("REST endpoint must be an http(s) URL");
  }
  return t;
}

function normalizeMacaroonHex(raw: string): string {
  const t = raw.trim().replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(t) || t.length < 32) {
    throw new Error("Macaroon must be hex");
  }
  return t.toLowerCase();
}

/** Extract `https://…` from `config=https://…` (QR may include other noise). */
export function extractBtcPayConfigUrl(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(/config=(https?:\/\/\S+)/i);
  if (m?.[1]) {
    // Strip trailing punctuation from QR OCR / share sheets
    return m[1].replace(/[),.;]+$/, "");
  }
  if (/^https?:\/\/.+/i.test(t) && /lnd\.config|cryptoprocessor\/config|configuration/i.test(t)) {
    return t;
  }
  return null;
}

export function parseLndRestInline(raw: string): LndRestConfig | null {
  const t = raw.trim();
  if (!t || !/type\s*=\s*lnd-rest/i.test(t)) return null;

  const parts = t.split(";").map((p) => p.trim()).filter(Boolean);
  const map = new Map<string, string>();
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    map.set(key, val);
  }

  const type = map.get("type");
  if (type?.toLowerCase() !== "lnd-rest") return null;

  const server = map.get("server") ?? map.get("uri");
  const macaroon = map.get("macaroon") ?? map.get("adminmacaroon");
  if (!server || !macaroon) {
    throw new Error("lnd-rest string needs server= and macaroon=");
  }

  return {
    restUrl: normalizeRestUrl(server),
    macaroonHex: normalizeMacaroonHex(macaroon),
    certThumbprint: map.get("certthumbprint"),
    allowInsecure: map.get("allowinsecure")?.toLowerCase() === "true",
    source: "lnd-rest-string",
  };
}

export function parseBtcPayConfigJson(data: BtcPayConfigJson): LndRestConfig {
  const configurations = data.configurations;
  if (!Array.isArray(configurations) || configurations.length === 0) {
    throw new Error("BTCPay config has no configurations");
  }

  const lnd = configurations.find((c) => (c.type ?? "").toLowerCase() === "lnd-rest");
  if (!lnd) {
    throw new Error("Only BTCPay LND (REST) is supported for now");
  }

  const uri = lnd.uri?.trim();
  const mac = (lnd.adminMacaroon || lnd.macaroon || "").trim();
  if (!uri || !mac) {
    throw new Error("BTCPay LND config missing uri or macaroon");
  }

  return {
    restUrl: normalizeRestUrl(uri),
    macaroonHex: normalizeMacaroonHex(mac),
    source: "btcpay-json",
  };
}

/** Fetch BTCPay `config=` URL and parse LND REST credentials. */
export async function fetchBtcPayConfigUrl(configUrl: string): Promise<LndRestConfig> {
  const url = configUrl.trim();
  if (!/^https?:\/\/.+/i.test(url)) {
    throw new Error("Invalid BTCPay config URL");
  }

  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "manual",
  });

  // RN may still follow redirects; reject non-OK explicitly.
  if (!res.ok) {
    throw new Error(`BTCPay config fetch failed (${res.status})`);
  }

  const data = (await res.json()) as BtcPayConfigJson;
  const parsed = parseBtcPayConfigJson(data);
  return { ...parsed, source: "btcpay-config-url" };
}

/**
 * Resolve pasted / scanned payload into LND REST credentials.
 * Order: inline type=lnd-rest → config= URL fetch → JSON body.
 */
export async function resolveBtcPayOrLndPayload(raw: string): Promise<LndRestConfig> {
  const t = raw.trim();
  if (!t) throw new Error("Paste or scan a BTCPay LND (REST) config");

  const inline = parseLndRestInline(t);
  if (inline) return inline;

  const configUrl = extractBtcPayConfigUrl(t);
  if (configUrl) {
    return fetchBtcPayConfigUrl(configUrl);
  }

  if (t.startsWith("{")) {
    try {
      return parseBtcPayConfigJson(JSON.parse(t) as BtcPayConfigJson);
    } catch (e) {
      if (e instanceof Error && e.message.includes("LND")) throw e;
      throw new Error("Could not parse BTCPay JSON config");
    }
  }

  throw new Error(
    "Unrecognized config. Use BTCPay → Services → LND (REST) → QR or paste the connection config.",
  );
}

/** True if the QR/paste looks like a node config (not an ark address). */
export function looksLikeBtcPayOrLndConfig(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  if (extractBtcPayConfigUrl(t)) return true;
  if (/type\s*=\s*lnd-rest/i.test(t)) return true;
  if (t.startsWith("{") && /configurations/i.test(t)) return true;
  return false;
}
