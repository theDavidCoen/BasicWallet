/**
 * App-wide Nostr identity (one nsec for all wallets).
 * Secret in SecureStore; profile fields in AsyncStorage (non-secret).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { generateNostrKeys, parseNsecInput, pairFromSecretKey, type NostrKeyPair } from "./keys";

const NSEC_KEY = "basic.wallet.nostr.nsec.v1";
const PROFILE_KEY = "basic.wallet.nostr.profile.v1";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type NostrProfile = {
  displayName: string;
  nip05: string;
  lightningAddress: string;
  about: string;
  /** NIP-01 `picture` URL (optional). */
  picture: string;
  /** NIP-01 `website` URL (optional). */
  website: string;
};

export const EMPTY_PROFILE: NostrProfile = {
  displayName: "",
  nip05: "",
  lightningAddress: "",
  about: "",
  picture: "",
  website: "",
};

export type NostrPublicIdentity = {
  npub: string;
  pubkey: string;
  profile: NostrProfile;
};

async function loadSk(): Promise<Uint8Array | null> {
  const nsec = await SecureStore.getItemAsync(NSEC_KEY, SECURE_OPTIONS);
  if (!nsec) return null;
  try {
    return parseNsecInput(nsec).sk;
  } catch {
    return null;
  }
}

export async function hasNostrIdentity(): Promise<boolean> {
  const nsec = await SecureStore.getItemAsync(NSEC_KEY, SECURE_OPTIONS);
  return typeof nsec === "string" && nsec.length > 0;
}

export async function readNostrProfile(): Promise<NostrProfile> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (!raw) return { ...EMPTY_PROFILE };
    const parsed = JSON.parse(raw) as Partial<NostrProfile>;
    return {
      displayName: typeof parsed.displayName === "string" ? parsed.displayName : "",
      nip05: typeof parsed.nip05 === "string" ? parsed.nip05 : "",
      lightningAddress:
        typeof parsed.lightningAddress === "string" ? parsed.lightningAddress : "",
      about: typeof parsed.about === "string" ? parsed.about : "",
      picture: typeof parsed.picture === "string" ? parsed.picture : "",
      website: typeof parsed.website === "string" ? parsed.website : "",
    };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export async function writeNostrProfile(profile: NostrProfile): Promise<void> {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export async function readPublicIdentity(): Promise<NostrPublicIdentity | null> {
  const sk = await loadSk();
  if (!sk) return null;
  const pair = pairFromSecretKey(sk);
  const profile = await readNostrProfile();
  return { npub: pair.npub, pubkey: pair.pubkey, profile };
}

/** Load full keypair after caller has gated with biometrics. */
export async function loadNostrKeyPairForCrypto(): Promise<NostrKeyPair | null> {
  const sk = await loadSk();
  if (!sk) return null;
  return pairFromSecretKey(sk);
}

export async function storeNostrKeyPair(pair: NostrKeyPair): Promise<void> {
  await SecureStore.setItemAsync(NSEC_KEY, pair.nsec, SECURE_OPTIONS);
}

export async function generateAndStoreNostrIdentity(): Promise<NostrPublicIdentity> {
  const pair = generateNostrKeys();
  await storeNostrKeyPair(pair);
  const profile = await readNostrProfile();
  return { npub: pair.npub, pubkey: pair.pubkey, profile };
}

export async function importAndStoreNsec(raw: string): Promise<NostrPublicIdentity> {
  const pair = parseNsecInput(raw);
  await storeNostrKeyPair(pair);
  const profile = await readNostrProfile();
  return { npub: pair.npub, pubkey: pair.pubkey, profile };
}

/** Ensure an identity exists (generate if missing). Used by Path C enable. */
export async function ensureNostrIdentity(): Promise<NostrPublicIdentity> {
  const existing = await readPublicIdentity();
  if (existing) return existing;
  return generateAndStoreNostrIdentity();
}

export async function clearNostrIdentity(): Promise<void> {
  await SecureStore.deleteItemAsync(NSEC_KEY, SECURE_OPTIONS);
}
