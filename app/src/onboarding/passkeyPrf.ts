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

/** Subset of WebAuthn AuthenticatorSelectionCriteria used for create retries. */
type CreateSelection = {
  authenticatorAttachment?: "platform" | "cross-platform";
  residentKey?: "required" | "preferred" | "discouraged";
  requireResidentKey?: boolean;
  userVerification?: "required" | "preferred" | "discouraged";
};

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

/**
 * Credential Manager had no viable create provider (common on OEM skins when
 * Google Password Manager / passkey provider is off or no account is signed in).
 */
export class PasskeyNoCreateOptionError extends Error {
  constructor(
    message = "No passkey provider is available to create a passkey on this device.",
  ) {
    super(message);
    this.name = "PasskeyNoCreateOptionError";
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

function errorText(e: unknown): string {
  if (e instanceof Error) return `${e.name} ${e.message}`;
  return String(e);
}

/** Native module often surfaces the full Java exception via else → e.toString(). */
export function isNoCreateOptionError(e: unknown): boolean {
  if (e instanceof PasskeyNoCreateOptionError) return true;
  const t = errorText(e);
  return /NoCreateOption|no create options available/i.test(t);
}

/**
 * Credential Manager / provider missing or misconfigured — same class of failure
 * as NoCreateOption (no viable passkey manager on device).
 * Avoid matching WebAuthn DomError names that merely contain "NotSupported".
 */
export function isPasskeyManagerUnavailableError(e: unknown): boolean {
  if (isNoCreateOptionError(e)) return true;
  const t = errorText(e);
  if (/NotConfigured|ProviderConfiguration/i.test(t)) return true;
  // react-native-passkeys maps CreateCredentialUnsupportedException → "NotSupported"
  if (/\bNotSupported\b/.test(t) && !/DomError/i.test(t)) return true;
  return false;
}

function isUserCancelledError(e: unknown): boolean {
  return /UserCancelled|cancel/i.test(errorText(e));
}

function isInterruptedError(e: unknown): boolean {
  return /Interrupted/i.test(errorText(e));
}

/**
 * Map Credential Manager / WebAuthn create failures to user-facing errors
 * (never raw androidx stack traces in UI).
 */
export function mapPasskeyCreateError(e: unknown): Error {
  if (
    e instanceof PasskeyNoCreateOptionError ||
    e instanceof PasskeyPrfUnavailableError ||
    e instanceof PasskeyNotFoundError
  ) {
    return e;
  }
  if (isPasskeyManagerUnavailableError(e)) {
    return new PasskeyNoCreateOptionError(
      "No passkey provider is available on this device.\n\n" +
        "Enable Google Password Manager (or another passkey provider) in system settings, " +
        "sign in to a Google account if needed, then try again.\n\n" +
        "Or continue without passkey.",
    );
  }
  if (isUserCancelledError(e)) {
    return new PasskeyPrfUnavailableError("Passkey creation was cancelled.");
  }
  if (e instanceof Error && !/androidx\.credentials|CreateCredential/i.test(e.message)) {
    return e;
  }
  return new PasskeyPrfUnavailableError(
    "Could not create a passkey. Enable a passkey provider (Google Password Manager) and try again.",
  );
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
    // Surface missing-provider failures immediately — do not fall through to a
    // create attempt that will also fail with NoCreateOption.
    if (isPasskeyManagerUnavailableError(e)) {
      throw mapPasskeyCreateError(e);
    }
    console.warn("[basic] discoverable passkey get failed", e);
  }

  const credentialId = await SecureStore.getItemAsync(CRED_ID_KEY, SECURE_OPTIONS);
  if (credentialId) {
    try {
      const entropy = await getPrfFromAssertion([{ id: credentialId, type: "public-key" }]);
      if (entropy) return entropy;
    } catch (e) {
      if (isPasskeyManagerUnavailableError(e)) {
        throw mapPasskeyCreateError(e);
      }
      console.warn("[basic] passkey get with stored id failed", e);
    }
  }

  throw new PasskeyNotFoundError();
}

/** Platform-bound create — steers Android Credential Manager toward GPM / device unlock. */
const PLATFORM_CREATE_SELECTION: CreateSelection = {
  authenticatorAttachment: "platform",
  residentKey: "required",
  requireResidentKey: true,
  userVerification: "required",
};

/**
 * Broader create — omit attachment so OEM Credential Manager can offer other
 * providers when platform-only returns NoCreateOption (seen on OnePlus / OxygenOS).
 */
const OPEN_CREATE_SELECTION: CreateSelection = {
  residentKey: "preferred",
  requireResidentKey: false,
  userVerification: "required",
};

async function createPasskeyCredential(selection: CreateSelection) {
  const challenge = await randomChallengeB64Url();
  const saltB64 = bytesToBase64Url(BASIC_PRF_SALT);
  const userId = await ensureUserIdB64Url();
  return Passkeys.create({
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
    authenticatorSelection: selection,
    extensions: { prf: { eval: { first: saltB64 } } },
  });
}

/**
 * Explicit first-time create. Caller must only invoke after user confirms “create new”.
 * Retries with alternate authenticatorSelection when Credential Manager reports no options.
 */
export async function createNewPrfEntropy(): Promise<Uint8Array> {
  if (!Passkeys.isSupported()) {
    throw new PasskeyPrfUnavailableError(
      "Passkeys are not supported on this device. Need a device with platform passkeys.",
    );
  }

  let creation: Awaited<ReturnType<typeof Passkeys.create>>;
  try {
    creation = await createPasskeyCredential(PLATFORM_CREATE_SELECTION);
  } catch (e) {
    if (isInterruptedError(e)) {
      try {
        creation = await createPasskeyCredential(PLATFORM_CREATE_SELECTION);
      } catch (e2) {
        if (isNoCreateOptionError(e2)) {
          try {
            creation = await createPasskeyCredential(OPEN_CREATE_SELECTION);
          } catch (e3) {
            throw mapPasskeyCreateError(e3);
          }
        } else {
          throw mapPasskeyCreateError(e2);
        }
      }
    } else if (isNoCreateOptionError(e)) {
      console.warn("[basic] passkey create: no options with platform; retrying open selection");
      try {
        creation = await createPasskeyCredential(OPEN_CREATE_SELECTION);
      } catch (e2) {
        throw mapPasskeyCreateError(e2);
      }
    } else {
      throw mapPasskeyCreateError(e);
    }
  }

  if (!creation) {
    throw new PasskeyPrfUnavailableError("Passkey creation was cancelled or failed.");
  }

  const enabled = creation.clientExtensionResults?.prf?.enabled;
  let results = creation.clientExtensionResults?.prf?.results;
  if (enabled === false && !results?.first) {
    throw new PasskeyPrfUnavailableError(
      "This password manager does not support WebAuthn PRF (required for Basic). " +
        "Enable Google Password Manager as your preferred passkey provider and try again.",
    );
  }

  let entropy: Uint8Array;
  if (results?.first) {
    entropy = extractPrfFirst(results);
  } else {
    // Many authenticators only report prf.enabled on create; evaluate on get.
    try {
      const fromGet = await getPrfFromAssertion([{ id: creation.id, type: "public-key" }]);
      if (!fromGet) {
        throw new PasskeyPrfUnavailableError("Passkey PRF evaluation was cancelled or failed.");
      }
      entropy = fromGet;
    } catch (e) {
      if (e instanceof PasskeyPrfUnavailableError) throw e;
      throw new PasskeyPrfUnavailableError(
        "This password manager created a passkey without PRF support. " +
          "Enable Google Password Manager as your preferred passkey provider and try again.",
      );
    }
  }

  // Persist only after PRF succeeded — a non-PRF credential id is useless.
  await SecureStore.setItemAsync(CRED_ID_KEY, creation.id, SECURE_OPTIONS);
  return entropy;
}

/**
 * Onboarding default: recover existing passkey. Never creates.
 * Use createNewPrfEntropy only after explicit user confirmation.
 */
export async function createOrGetPrfEntropy(): Promise<Uint8Array> {
  return getExistingPrfEntropy();
}
