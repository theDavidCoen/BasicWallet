/**
 * Persistent app log ring — captures console + optional app.push.
 *
 * Performance: ingest is cheap (no deep walks, no disk I/O). Disk work only on
 * Save / Share / Clear / AppState background. Secrets redacted at ingest (fast
 * patterns) and again on export (full patterns).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, type AppStateStatus } from "react-native";

export type AppLogLevel = "debug" | "info" | "warn" | "error" | "log";

export type AppLogEntry = {
  at: number;
  level: AppLogLevel;
  message: string;
};

const MAX_ENTRIES = 3_000;
const HISTORY_KEY = "basic.wallet.appLogs.v1";
const SESSION_KEY = "basic.wallet.appLogs.session.v1";
/** Drop flood so gesture / poll storms cannot stall the JS thread. */
const MAX_INGEST_PER_SEC = 30;

const buffer: AppLogEntry[] = [];
let installed = false;
let historyMerged = false;
let persistInFlight: Promise<void> | null = null;
let ingestWindowStart = 0;
let ingestWindowCount = 0;
let appStateSub: { remove: () => void } | null = null;

type ConsoleFns = {
  [K in AppLogLevel]: (...args: unknown[]) => void;
};

const originals: Partial<ConsoleFns> = {};

const REDACTED = "[redacted]";

/** Fast patterns for the hot path (every console call). */
const FAST_SECRET_PATTERNS: RegExp[] = [
  /\bn(?:sec|pub|profile|event|addr|ote|relay|cryptsec)1[a-z0-9]{20,}\b/gi,
  /\b[xyztuv](?:pub|prv)[1-9A-HJ-NP-Za-km-z]{50,}\b/gi,
  /\bxpriv[a-zA-Z0-9]+\b/gi,
  /\b[5KL][1-9A-HJ-NP-Za-km-z]{50,52}\b/g,
];

/** Extra patterns applied only on export / history commit. */
const FULL_SECRET_PATTERNS: RegExp[] = [
  ...FAST_SECRET_PATTERNS,
  /(?:private[_ -]?key|priv[_ -]?key|secret[_ -]?key|signing[_ -]?key|master[_ -]?key|sk|entropy)\s*[:=]\s*["']?[0-9a-fA-F]{64}["']?/gi,
  /(?:mnemonic|seed(?:\s*phrase)?|recovery\s*phrase)\s*[:=]\s*["']?[^"'\\\n]{8,}/gi,
  /\b(?:[a-z]{3,8}(?:\s+[a-z]{3,8}){11}(?:(?:\s+[a-z]{3,8}){3}){0,4})\b/g,
];

const SENSITIVE_KEY_RE =
  /^(mnemonic|seed(?:Phrase|phrase)?|recovery[_-]?phrase|nsec|npub|nprofile|ncryptsec|xpub|ypub|zpub|vpub|upub|tpub|xprv|yprv|zprv|vprv|tprv|xpriv|private[_-]?key|priv[_-]?key|secret[_-]?key|signing[_-]?key|master[_-]?key|prf(?:Output|Key)?|passphrase|password|pin|app[_-]?pin|macaroon|admin[_-]?macaroon|invoice[_-]?macaroon|lndhub[_-]?password|entropy|root[_-]?key)$/i;

const LEVELS = new Set<AppLogLevel>(["debug", "info", "log", "warn", "error"]);

function applyPatterns(text: string, patterns: RegExp[]): string {
  let out = text;
  for (const re of patterns) {
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  return out;
}

/** Hot-path redact (ingest). */
export function redactSecretsFast(text: string): string {
  return applyPatterns(text, FAST_SECRET_PATTERNS);
}

/** Full redact (export). */
export function redactSecrets(text: string): string {
  return applyPatterns(text, FULL_SECRET_PATTERNS);
}

/** Cheap stringify for ingest — no recursive key walk. */
function formatArgsFast(args: unknown[]): string {
  const parts: string[] = [];
  for (const arg of args) {
    if (arg == null) {
      parts.push(String(arg));
      continue;
    }
    const t = typeof arg;
    if (t === "string" || t === "number" || t === "boolean") {
      parts.push(String(arg));
      continue;
    }
    if (arg instanceof Error) {
      parts.push(`${arg.name}: ${arg.message}`);
      continue;
    }
    try {
      parts.push(JSON.stringify(arg));
    } catch {
      parts.push(String(arg));
    }
  }
  return redactSecretsFast(parts.join(" "));
}

function scrubSensitiveKeysDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (value == null) return value;
  if (typeof value === "string") return redactSecrets(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrubSensitiveKeysDeep(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? REDACTED : scrubSensitiveKeysDeep(v, depth + 1);
    }
    return out;
  }
  return redactSecrets(String(value));
}

function trimBuffer(): void {
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

function parseStoredEntries(raw: string): AppLogEntry[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: AppLogEntry[] = [];
    for (const row of parsed) {
      if (!row || typeof row !== "object") continue;
      const at = Number((row as AppLogEntry).at);
      const level = (row as AppLogEntry).level;
      const message = (row as AppLogEntry).message;
      if (!Number.isFinite(at) || typeof message !== "string") continue;
      if (!LEVELS.has(level as AppLogLevel)) continue;
      out.push({
        at,
        level: level as AppLogLevel,
        message: redactSecrets(message),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function entryKey(e: AppLogEntry): string {
  return `${e.at}|${e.level}|${e.message}`;
}

function mergeEntries(history: AppLogEntry[], session: AppLogEntry[]): AppLogEntry[] {
  const seen = new Set<string>();
  const out: AppLogEntry[] = [];
  for (const e of [...history, ...session]) {
    const k = entryKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  out.sort((a, b) => a.at - b.at);
  if (out.length > MAX_ENTRIES) return out.slice(out.length - MAX_ENTRIES);
  return out;
}

async function flushSessionPersist(): Promise<void> {
  if (persistInFlight) return persistInFlight;
  persistInFlight = (async () => {
    try {
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(buffer));
    } catch {
      /* ignore */
    } finally {
      persistInFlight = null;
    }
  })();
  return persistInFlight;
}

function onAppStateChange(next: AppStateStatus): void {
  if (next === "background" || next === "inactive") {
    void flushSessionPersist();
  }
}

function pushEntry(level: AppLogLevel, args: unknown[]): void {
  const now = Date.now();
  if (now - ingestWindowStart >= 1000) {
    ingestWindowStart = now;
    ingestWindowCount = 0;
  }
  if (ingestWindowCount >= MAX_INGEST_PER_SEC) return;
  ingestWindowCount += 1;

  const message = formatArgsFast(args);
  if (!message) return;
  buffer.push({ at: now, level, message });
  trimBuffer();
  // No disk I/O here — persist only on background / export.
}

/** Install once at process start. Does not load history. */
export function installAppLogCapture(): void {
  if (installed) return;
  installed = true;

  // Prefer warn/error — log/debug/info still captured but are rarer.
  const levels: AppLogLevel[] = ["debug", "info", "log", "warn", "error"];
  for (const level of levels) {
    if (typeof console[level] !== "function") continue;
    const original = console[level].bind(console);
    originals[level] = original;
    console[level] = (...args: unknown[]) => {
      try {
        pushEntry(level, args);
      } catch {
        /* never break console */
      }
      original(...args);
    };
  }

  appStateSub?.remove();
  appStateSub = AppState.addEventListener("change", onAppStateChange);

  pushEntry("info", ["[basic] appLog capture installed"]);
}

export async function ensureAppLogsHydrated(): Promise<void> {
  if (historyMerged) return;
  try {
    const [histRaw, sessRaw] = await AsyncStorage.multiGet([HISTORY_KEY, SESSION_KEY]);
    const history = histRaw[1] ? parseStoredEntries(histRaw[1]) : [];
    const sessionDisk = sessRaw[1] ? parseStoredEntries(sessRaw[1]) : [];
    const sessionNow = buffer.splice(0, buffer.length);
    buffer.push(...mergeEntries(history, mergeEntries(sessionDisk, sessionNow)));
  } catch {
    /* ignore */
  } finally {
    historyMerged = true;
  }
}

async function commitHistoryAfterExport(): Promise<void> {
  try {
    // Deep scrub once at commit so sensitive object keys never sit on disk.
    const scrubbed = buffer.map((e) => ({
      ...e,
      message: redactSecrets(e.message),
    }));
    buffer.length = 0;
    buffer.push(...scrubbed);
    await AsyncStorage.multiSet([
      [HISTORY_KEY, JSON.stringify(buffer)],
      [SESSION_KEY, "[]"],
    ]);
  } catch {
    /* ignore */
  }
}

export async function whenAppLogsReady(): Promise<void> {
  await ensureAppLogsHydrated();
}

export function appLog(level: AppLogLevel, ...args: unknown[]): void {
  pushEntry(level, args);
  const out = originals[level] ?? console[level]?.bind(console) ?? console.log.bind(console);
  out(...args);
}

export function getAppLogEntries(): readonly AppLogEntry[] {
  return buffer;
}

export function getAppLogCount(): number {
  return buffer.length;
}

export async function prepareLogsForExport(): Promise<readonly AppLogEntry[]> {
  await ensureAppLogsHydrated();
  // Re-scrub messages before export.
  for (let i = 0; i < buffer.length; i++) {
    const e = buffer[i]!;
    buffer[i] = { ...e, message: redactSecrets(e.message) };
  }
  await commitHistoryAfterExport();
  return buffer;
}

export async function clearAppLogs(): Promise<void> {
  buffer.length = 0;
  historyMerged = true;
  try {
    await AsyncStorage.multiRemove([HISTORY_KEY, SESSION_KEY]);
  } catch {
    /* ignore */
  }
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function iso(ms: number): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

export function buildAppLogsCsv(entries: readonly AppLogEntry[] = buffer): string {
  const lines = ["timestamp_iso,level,message"];
  for (const e of entries) {
    lines.push(
      [
        csvEscape(iso(e.at)),
        csvEscape(e.level),
        csvEscape(redactSecrets(e.message)),
      ].join(","),
    );
  }
  return `\uFEFF${lines.join("\n")}\n`;
}

export function buildAppLogsRaw(entries: readonly AppLogEntry[] = buffer): string {
  const lines: string[] = [];
  for (const e of entries) {
    const lvl = e.level.toUpperCase().padEnd(5, " ");
    lines.push(`${iso(e.at)} ${lvl} ${redactSecrets(e.message)}`);
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

export function defaultLogsFilename(ext: "csv" | "log"): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `basic-wallet-logs-${stamp}.${ext}`;
}

// Keep scrubSensitiveKeysDeep referenced for export-time object scrubbing if needed later.
void scrubSensitiveKeysDeep;
