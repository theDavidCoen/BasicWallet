/**
 * WebDAV put/get for the Path C cipher blob.
 * Auth: Bearer token and/or HTTP Basic (Nextcloud app password).
 */

import { base64 } from "@scure/base";
import { utf8ToBytes } from "@noble/hashes/utils.js";
import type { CipherBlob } from "./backupPackage";
import {
  homeCredsHaveAuth,
  loadHomeServerCreds,
  type HomeServerCreds,
} from "./homeServerCreds";

export const HOME_BACKUP_FILENAME = "basic-wallet-backup.v1.json";
export const HOME_BACKUP_DIR = "BasicWallet";

function trimSlash(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

/**
 * Resolve the file URL to PUT/GET.
 * - Full DAV/file URL ending in .json → as-is
 * - DAV directory → append filename
 * - Nextcloud origin + username → …/remote.php/dav/files/{user}/BasicWallet/filename
 * - Generic origin → {origin}/basic-wallet-backup.v1.json
 */
export function resolveHomeBackupFileUrl(
  baseUrl: string,
  username?: string | null,
): string {
  const u = trimSlash(baseUrl);
  if (!u) throw new Error("Home server URL is empty");
  if (/\.json$/i.test(u)) return u;
  if (/\/remote\.php\/dav\//i.test(u)) {
    return `${u}/${HOME_BACKUP_FILENAME}`;
  }
  if (username?.trim()) {
    const user = encodeURIComponent(username.trim());
    return `${u}/remote.php/dav/files/${user}/${HOME_BACKUP_DIR}/${HOME_BACKUP_FILENAME}`;
  }
  return `${u}/${HOME_BACKUP_FILENAME}`;
}

function parentCollectionUrl(fileUrl: string): string | null {
  const i = fileUrl.lastIndexOf("/");
  if (i <= "https://x".length) return null;
  return fileUrl.slice(0, i);
}

function authHeaders(creds: HomeServerCreds): Record<string, string> {
  const h: Record<string, string> = {};
  if (creds.username && creds.password) {
    const raw = `${creds.username}:${creds.password}`;
    h.Authorization = `Basic ${base64.encode(utf8ToBytes(raw))}`;
    return h;
  }
  if (creds.token) {
    h.Authorization = `Bearer ${creds.token}`;
  }
  return h;
}

async function ensureCollection(
  collectionUrl: string,
  headers: Record<string, string>,
): Promise<void> {
  // MKCOL is idempotent enough: 201 created, 405/409 already exists.
  const res = await fetch(collectionUrl, {
    method: "MKCOL",
    headers: { ...headers, Accept: "*/*" },
  });
  if (res.ok || res.status === 405 || res.status === 409 || res.status === 301) {
    return;
  }
  // Some servers reject MKCOL without auth differently — ignore if PUT may still work.
  if (res.status === 401 || res.status === 403) {
    const t = (await res.text().catch(() => "")).slice(0, 120);
    throw new Error(t || `WebDAV MKCOL failed (${res.status})`);
  }
}

export async function uploadHomeBackupCipher(
  homeUrl: string,
  blob: CipherBlob,
  credsOverride?: HomeServerCreds,
): Promise<{ fileUrl: string }> {
  const creds = credsOverride ?? (await loadHomeServerCreds());
  if (!homeUrl.trim()) {
    throw new Error("Home server URL required");
  }
  if (!homeCredsHaveAuth(creds)) {
    throw new Error(
      "Home server credentials required (Bearer token or username + app password)",
    );
  }
  const fileUrl = resolveHomeBackupFileUrl(homeUrl, creds.username);
  const headers = {
    ...authHeaders(creds),
    "Content-Type": "application/json",
    Accept: "application/json, */*",
  };

  const parent = parentCollectionUrl(fileUrl);
  if (parent && /\/BasicWallet$/i.test(parent)) {
    try {
      await ensureCollection(parent, headers);
    } catch (e) {
      console.warn("[basic] home MKCOL", e);
      // continue — folder may already exist
    }
  }

  const res = await fetch(fileUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify(blob),
  });
  if (!res.ok) {
    const t = (await res.text().catch(() => "")).slice(0, 180);
    throw new Error(t || `Home upload failed (HTTP ${res.status})`);
  }
  return { fileUrl };
}

export async function downloadHomeBackupCipher(
  homeUrl: string,
  credsOverride?: HomeServerCreds,
): Promise<CipherBlob> {
  const creds = credsOverride ?? (await loadHomeServerCreds());
  const fileUrl = resolveHomeBackupFileUrl(homeUrl, creds.username);
  const res = await fetch(fileUrl, {
    method: "GET",
    headers: {
      ...authHeaders(creds),
      Accept: "application/json, */*",
    },
  });
  if (!res.ok) {
    const t = (await res.text().catch(() => "")).slice(0, 180);
    throw new Error(t || `Home download failed (HTTP ${res.status})`);
  }
  const json = (await res.json()) as Partial<CipherBlob>;
  if (!json.saltHex || !json.ivHex || !json.ciphertextHex) {
    throw new Error("Home server returned an invalid backup file");
  }
  return {
    saltHex: json.saltHex,
    ivHex: json.ivHex,
    ciphertextHex: json.ciphertextHex,
    iters: typeof json.iters === "number" ? json.iters : undefined,
  };
}
