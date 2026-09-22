/**
 * Passkey WebAuthn PRF → 256-bit entropy → BIP39 mnemonic.
 *
 * Uses react-native-passkeys (Credential Manager / platform WebAuthn).
 * PRF needs Android API 34+ / iOS 18+ and a verified rpId (assetlinks / AASA).
 *
 * Never log or return the mnemonic from this module.
 * Never silently create a new passkey when an existing one might still be in the OS vault.
 */

import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as Passkeys from "react-native-passkeys";
import { PASSKEY_RP_ID, PASSKEY_RP_NAME } from "../config/passkey";

export class PasskeyPrfUnavailableError extends Error {
  constructor(message = "Passkey PRF is not available in this build") {
    super(message);
    this.name = "PasskeyPrfUnavailableError";
  }
}

/** No local credential and discoverable get found nothing — go to restore hub, do not create. */
export class PasskeyNotFoundError extends Error {
  constructor(message = "No matching passkey found for Basic Wallet") {
    super(message);
    this.name = "PasskeyNotFoundError";
  }
}

/** Fixed app salt for PRF (public). Change only with a migration plan. */
export const BASIC_PRF_SALT = new TextEncoder().encode("basic.wallet.passkey.prf.v1");

const CRED_ID_KEY = "basic.wallet.passkey.credentialId.v1";
const USER_ID_KEY = "basic.wallet.passkey.userId.v1";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  const b64 = globalThis.btoa(binary);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function randomChallengeB64Url(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return bytesToBase64Url(new Uint8Array(bytes));
}

async function ensureUserIdB64Url(): Promise<string> {
  const existing = await SecureStore.getItemAsync(USER_ID_KEY, SECURE_OPTIONS);
  if (existing) return existing;
  const bytes = await Crypto.getRandomBytesAsync(16);
  const id = bytesToBase64Url(new Uint8Array(bytes));
  await SecureStore.setItemAsync(USER_ID_KEY, id, SECURE_OPTIONS);
  return id;
}

function extractPrfFirst(results: { first?: string } | undefined): Uint8Array {
  if (!results?.first) {
    throw new PasskeyPrfUnavailableError(
      "Authenticator did not return PRF results. Need Android 14+ / iOS 18+ with PRF support.",
    );
  }
  const raw = base64UrlToBytes(results.first);
  if (raw.length < 32) {
    throw new Error("PRF output shorter than 32 bytes");
  }
  return raw.slice(0, 32);
}

async function getPrfFromAssertion(allowCredentials?: { id: string; type: "public-key" }[]) {
  const challenge = await randomChallengeB64Url();
  const saltB64 = bytesToBase64Url(BASIC_PRF_SALT);
  const assertion = await Passkeys.get({
    challenge,
    rpId: PASSKEY_RP_ID,
    userVerification: "required",
    ...(allowCredentials?.length ? { allowCredentials } : {}),
    extensions: { prf: { eval: { first: saltB64 } } },
  });
  if (!assertion) return null;
  if (assertion.id) {
    await SecureStore.setItemAsync(CRED_ID_KEY, assertion.id, SECURE_OPTIONS);
  }
  return extractPrfFirst(assertion.clientExtensionResults?.prf?.results);
}

/**
 * Recover entropy from an existing passkey (local id or discoverable OS credential).
 * Does not create. Throws PasskeyNotFoundError when nothing matches.
 */
export async function getExistingPrfEntropy(): Promise<Uint8Array> {
  if (!Passkeys.isSupported()) {
    throw new PasskeyPrfUnavailableError(
      "Passkeys are not supported on this device. Need a device with platform passkeys.",
    );
  }

  // Prefer discoverable credentials first (OS password manager picker). After a
  // factory reset the local credentialId is gone; after a mistaken create it may
  // point at the wrong passkey — letting the OS list avoids silent wrong wallets.
  try {
    const entropy = await getPrfFromAssertion();
    if (entropy) return entropy;
  } catch (e) {
    console.warn("[basic] discoverable passkey get failed", e);
  }

  const credentialId = await SecureStore.getItemAsync(CRED_ID_KEY, SECURE_OPTIONS);
  if (credentialId) {
    try {
      const entropy = await getPrfFromAssertion([{ id: credentialId, type: "public-key" }]);
      if (entropy) return entropy;
    } catch (e) {
      console.warn("[basic] passkey get with stored id failed", e);
    }
  }

  throw new PasskeyNotFoundError();
}

/**
 * Explicit first-time create. Caller must only invoke after user confirms “create new”.
 */
export async function createNewPrfEntropy(): Promise<Uint8Array> {
  if (!Passkeys.isSupported()) {
    throw new PasskeyPrfUnavailableError(
      "Passkeys are not supported on this device. Need a device with platform passkeys.",
    );
  }

  const challenge = await randomChallengeB64Url();
  const saltB64 = bytesToBase64Url(BASIC_PRF_SALT);
  const userId = await ensureUserIdB64Url();
  const creation = await Passkeys.create({
    challenge,
    rp: { id: PASSKEY_RP_ID, name: PASSKEY_RP_NAME },
    user: {
      id: userId,
      name: "basic-wallet",
      displayName: "Basic Wallet",
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    },
    extensions: { prf: { eval: { first: saltB64 } } },
  });

  if (!creation) {
    throw new PasskeyPrfUnavailableError("Passkey creation was cancelled or failed.");
  }

  const enabled = creation.clientExtensionResults?.prf?.enabled;
  let results = creation.clientExtensionResults?.prf?.results;
  if (enabled === false && !results?.first) {
    throw new PasskeyPrfUnavailableError(
      "This authenticator does not support the WebAuthn PRF extension.",
    );
  }

  await SecureStore.setItemAsync(CRED_ID_KEY, creation.id, SECURE_OPTIONS);

  if (!results?.first) {
    const entropy = await getPrfFromAssertion([{ id: creation.id, type: "public-key" }]);
    if (!entropy) {
      throw new PasskeyPrfUnavailableError("Passkey PRF evaluation was cancelled or failed.");
    }
    return entropy;
  }

  return extractPrfFirst(results);
}

/**
 * Onboarding default: recover existing passkey. Never creates.
 * Use createNewPrfEntropy only after explicit user confirmation.
 */
export async function createOrGetPrfEntropy(): Promise<Uint8Array> {
  return getExistingPrfEntropy();
}
