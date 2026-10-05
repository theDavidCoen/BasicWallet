/**
 * Cursor Cloud API key in SecureStore (same class as LNDHub / home creds).
 * Bitrefill / other MCP secrets are never stored here — they stay on the
 * user's Cursor Cloud / Dashboard configuration.
 */

import * as SecureStore from "expo-secure-store";

const CREDS_KEY = "basic.wallet.cursor.apiKey.v1";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type StoredCursorAgentCreds = {
  apiKey: string;
  /** From GET /v1/me — display only; never log full key. */
  apiKeyName?: string | null;
  userEmail?: string | null;
  savedAt: number;
};

export async function loadCursorApiKey(): Promise<string | null> {
  const rec = await loadCursorAgentCredentials();
  return rec?.apiKey ?? null;
}

export async function loadCursorAgentCredentials(): Promise<StoredCursorAgentCreds | null> {
  try {
    const raw = await SecureStore.getItemAsync(CREDS_KEY, SECURE_OPTIONS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCursorAgentCreds>;
    if (typeof parsed.apiKey !== "string" || !parsed.apiKey.trim()) return null;
    return {
      apiKey: parsed.apiKey.trim(),
      apiKeyName: typeof parsed.apiKeyName === "string" ? parsed.apiKeyName : null,
      userEmail: typeof parsed.userEmail === "string" ? parsed.userEmail : null,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function saveCursorAgentCredentials(
  rec: Omit<StoredCursorAgentCreds, "savedAt"> & { savedAt?: number },
): Promise<void> {
  const apiKey = rec.apiKey.trim();
  if (!apiKey) {
    await clearCursorAgentCredentials();
    return;
  }
  const next: StoredCursorAgentCreds = {
    apiKey,
    apiKeyName: rec.apiKeyName ?? null,
    userEmail: rec.userEmail ?? null,
    savedAt: rec.savedAt ?? Date.now(),
  };
  await SecureStore.setItemAsync(CREDS_KEY, JSON.stringify(next), SECURE_OPTIONS);
}

export async function clearCursorAgentCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CREDS_KEY, SECURE_OPTIONS);
  } catch {
    /* missing ok */
  }
}

/** Mask for UI — never log the full key. */
export function maskCursorApiKey(apiKey: string): string {
  const t = apiKey.trim();
  if (t.length <= 10) return "••••••••";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export { CREDS_KEY as CURSOR_API_KEY_SECURE_KEY };
