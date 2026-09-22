/**
 * Home-server secrets (Bearer token and/or Nextcloud app password).
 * URL + username live in backup meta (non-secret); password/token here.
 */

import * as SecureStore from "expo-secure-store";

const CREDS_KEY = "basic.wallet.home.creds.v1";
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type HomeServerCreds = {
  /** Bearer / opaque access token (optional). */
  token: string | null;
  /** Nextcloud (or WebDAV) username. */
  username: string | null;
  /** Nextcloud application password (or WebDAV password). */
  password: string | null;
};

const EMPTY: HomeServerCreds = { token: null, username: null, password: null };

export async function loadHomeServerCreds(): Promise<HomeServerCreds> {
  try {
    const raw = await SecureStore.getItemAsync(CREDS_KEY, SECURE_OPTIONS);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<HomeServerCreds>;
    return {
      token: typeof parsed.token === "string" && parsed.token ? parsed.token : null,
      username:
        typeof parsed.username === "string" && parsed.username ? parsed.username : null,
      password:
        typeof parsed.password === "string" && parsed.password ? parsed.password : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveHomeServerCreds(creds: HomeServerCreds): Promise<void> {
  const next: HomeServerCreds = {
    token: creds.token?.trim() || null,
    username: creds.username?.trim() || null,
    password: creds.password?.trim() || null,
  };
  if (!next.token && !next.username && !next.password) {
    await clearHomeServerCreds();
    return;
  }
  await SecureStore.setItemAsync(CREDS_KEY, JSON.stringify(next), SECURE_OPTIONS);
}

export async function clearHomeServerCreds(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(CREDS_KEY, SECURE_OPTIONS);
  } catch {
    /* */
  }
}

export function homeCredsHaveAuth(c: HomeServerCreds): boolean {
  if (c.token) return true;
  if (c.username && c.password) return true;
  return false;
}
