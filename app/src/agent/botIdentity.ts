/**
 * Per-device Cursor bot Nostr identity + owner binding.
 * Bot nsec is separate from the user's identityStore nsec.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  generateNostrKeys,
  parseNsecInput,
  pairFromSecretKey,
  type NostrKeyPair,
} from "../nostr/keys";
import { readPublicIdentity } from "../nostr/identityStore";

const BOT_NSEC_KEY = "basic.wallet.cursor.bot.nsec.v1";
const BOT_META_KEY = "basic.wallet.cursor.bot.meta.v1";
const BOT_AGENT_ID_KEY = "basic.wallet.cursor.agentId.v1";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type BotMeta = {
  enabled: boolean;
  botNpub: string;
  botPubkey: string;
  /** Hex pubkey of the activating Basic user — only this npub may talk to the bot. */
  ownerPubkey: string;
  ownerNpub: string;
  createdAt: number;
  updatedAt: number;
};

async function loadSk(): Promise<Uint8Array | null> {
  const nsec = await SecureStore.getItemAsync(BOT_NSEC_KEY, SECURE_OPTIONS);
  if (!nsec) return null;
  try {
    return parseNsecInput(nsec).sk;
  } catch {
    return null;
  }
}

export async function readBotMeta(): Promise<BotMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(BOT_META_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<BotMeta>;
    if (
      typeof p.botNpub !== "string" ||
      typeof p.botPubkey !== "string" ||
      typeof p.ownerPubkey !== "string" ||
      typeof p.ownerNpub !== "string"
    ) {
      return null;
    }
    return {
      enabled: p.enabled === true,
      botNpub: p.botNpub,
      botPubkey: p.botPubkey.toLowerCase(),
      ownerPubkey: p.ownerPubkey.toLowerCase(),
      ownerNpub: p.ownerNpub,
      createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
      updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

async function writeBotMeta(meta: BotMeta): Promise<void> {
  await AsyncStorage.setItem(BOT_META_KEY, JSON.stringify(meta));
}

export async function hasBotIdentity(): Promise<boolean> {
  const nsec = await SecureStore.getItemAsync(BOT_NSEC_KEY, SECURE_OPTIONS);
  return typeof nsec === "string" && nsec.length > 0;
}

export async function isBotEnabled(): Promise<boolean> {
  const meta = await readBotMeta();
  if (!meta?.enabled) return false;
  return hasBotIdentity();
}

export async function loadBotKeyPair(): Promise<NostrKeyPair | null> {
  const sk = await loadSk();
  if (!sk) return null;
  return pairFromSecretKey(sk);
}

export async function loadStoredCursorAgentId(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(BOT_AGENT_ID_KEY);
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export async function storeCursorAgentId(agentId: string | null): Promise<void> {
  try {
    if (!agentId?.trim()) {
      await AsyncStorage.removeItem(BOT_AGENT_ID_KEY);
      return;
    }
    await AsyncStorage.setItem(BOT_AGENT_ID_KEY, agentId.trim());
  } catch {
    /* */
  }
}

/**
 * Ensure bot nsec exists and bind to the current user identity as owner.
 * Does not enable the watcher by itself — caller sets enabled + starts watch.
 */
export async function ensureBotIdentityForOwner(): Promise<BotMeta> {
  const owner = await readPublicIdentity();
  if (!owner) {
    throw new Error("Create a Nostr identity before activating the Cursor agent.");
  }

  let pair = await loadBotKeyPair();
  if (!pair) {
    pair = generateNostrKeys();
    await SecureStore.setItemAsync(BOT_NSEC_KEY, pair.nsec, SECURE_OPTIONS);
  }

  const now = Date.now();
  const existing = await readBotMeta();
  const meta: BotMeta = {
    enabled: true,
    botNpub: pair.npub,
    botPubkey: pair.pubkey.toLowerCase(),
    ownerPubkey: owner.pubkey.toLowerCase(),
    ownerNpub: owner.npub,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeBotMeta(meta);
  return meta;
}

export async function setBotEnabled(enabled: boolean): Promise<BotMeta | null> {
  const meta = await readBotMeta();
  if (!meta) return null;
  const next = { ...meta, enabled, updatedAt: Date.now() };
  await writeBotMeta(next);
  return next;
}

/** Wipe bot nsec, meta, and stored Cursor agent session id. */
export async function wipeBotIdentity(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(BOT_NSEC_KEY, SECURE_OPTIONS);
  } catch {
    /* */
  }
  try {
    await AsyncStorage.removeItem(BOT_META_KEY);
  } catch {
    /* */
  }
  try {
    await AsyncStorage.removeItem(BOT_AGENT_ID_KEY);
  } catch {
    /* */
  }
  try {
    await AsyncStorage.removeItem("basic.wallet.cursor.bot.processed.v1");
  } catch {
    /* */
  }
}

export { BOT_NSEC_KEY as CURSOR_BOT_NSEC_SECURE_KEY };
