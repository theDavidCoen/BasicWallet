/**
 * Arkade HD wallet factory — one open engine per selected wallet_id.
 * Behavior aligned with arkade.money; HD mandatory per tech-spec.
 */

import {
  Wallet,
  MnemonicIdentity,
  ProviderUnavailableError,
  EsploraProvider,
  RestDelegateProvider,
} from "@arkade-os/sdk";
import { ExpoArkProvider, ExpoIndexerProvider } from "@arkade-os/sdk/adapters/expo";
import { getNetworkConfig } from "../config/network";
import {
  readDelegateSettings,
  resolveDelegateUrl,
} from "../arkade/delegateSettings";
import { loadMnemonicForCrypto, storeMnemonic } from "../security/mnemonicStore";
import { MUTINYNET_ARK_INFO_SNAPSHOT } from "./mutinynetArkInfoSeed";
import { ensurePersistentStorageReady } from "./persistentStorage";

export type BasicWallet = Awaited<ReturnType<typeof Wallet.create>>;

let openWalletId: string | null = null;
let walletSingleton: BasicWallet | null = null;
/** In-process: skip a second restore for the same walletId. */
const restoreDone = new Set<string>();
/** Seeded mnemonics that still need a one-shot gap restore (create/import). */
const pendingRestore = new Set<string>();
const restorePromises = new Map<string, Promise<void>>();

const GET_INFO_TIMEOUT_MS = 8_000;
const CREATE_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

class TimedExpoArkProvider extends ExpoArkProvider {
  override async getInfo() {
    try {
      return await withTimeout(super.getInfo(), GET_INFO_TIMEOUT_MS, "getInfo");
    } catch (cause) {
      throw new ProviderUnavailableError("Ark getInfo unavailable", { cause });
    }
  }
}

class NoWatchEsploraProvider extends EsploraProvider {
  override async watchAddresses(
    _addresses: string[],
    _callback: (txs: never[]) => void,
  ): Promise<() => void> {
    return () => {};
  }

  override async getTransactions(address: string) {
    try {
      return await withTimeout(super.getTransactions(address), 4_000, "esplora.getTransactions");
    } catch {
      return [];
    }
  }

  override async getCoins(address: string) {
    try {
      return await withTimeout(super.getCoins(address), 4_000, "esplora.getCoins");
    } catch {
      return [];
    }
  }
}

async function ensureArkInfoSnapshotSeed(
  walletRepository: {
    getWalletState: () => Promise<{ settings?: Record<string, unknown> } | null>;
    saveWalletState: (state: { settings?: Record<string, unknown> }) => Promise<void>;
  },
  networkId: string,
): Promise<void> {
  if (networkId !== "mutinynet") return;
  try {
    const state = (await walletRepository.getWalletState()) ?? {};
    const settings = { ...(state.settings ?? {}) };
    if (settings.arkInfoSnapshot) return;
    settings.arkInfoSnapshot = MUTINYNET_ARK_INFO_SNAPSHOT;
    await walletRepository.saveWalletState({ ...state, settings });
  } catch (e) {
    console.warn("[basic] arkInfo seed failed", e);
  }
}

export type CreateWalletOpts = {
  /** Default true (import/restore). Passkey rematerialize can defer restore. */
  runRestore?: boolean;
};

/** Drop in-memory restore skip so the next explicit restore will run. */
export function clearRestoreDone(walletId: string): void {
  restoreDone.delete(walletId);
}

/** Mark wallet for gap restore on next open (create / mnemonic import). */
export function markRestorePending(walletId: string): void {
  restoreDone.delete(walletId);
  pendingRestore.add(walletId);
}

export function consumeRestorePending(walletId: string): boolean {
  if (!pendingRestore.has(walletId)) return false;
  pendingRestore.delete(walletId);
  return true;
}

export async function createHdWalletFromMnemonic(
  walletId: string,
  mnemonic: string,
  opts: CreateWalletOpts = {},
): Promise<BasicWallet> {
  await storeMnemonic(walletId, mnemonic);
  clearRestoreDone(walletId);
  pendingRestore.delete(walletId);
  return openHdWalletFromKeystore(walletId, { runRestore: opts.runRestore !== false });
}

/** Persist mnemonic only — no Wallet.create / restore (for passkey child rematerialize). */
export async function seedMnemonicOnly(walletId: string, mnemonic: string): Promise<void> {
  await storeMnemonic(walletId, mnemonic);
  // Next openWalletAndSync should gap-scan once (create/import), not every cold start.
  markRestorePending(walletId);
}

export type WalletMode = "hd" | "static";

export type OpenWalletOpts = {
  runRestore?: boolean;
  /** Default hd. Fiat Mode uses static to avoid multi-address reopen noise. */
  walletMode?: WalletMode;
};

type CreateEngineOpts = {
  /** When true, skip gap restore (peek / address-only). Default false for open path. */
  runRestore?: boolean;
  walletMode?: WalletMode;
};

/** Active engine mode (for Fiat Mode HD↔static switch). */
let openWalletMode: WalletMode = "hd";

export function getOpenWalletMode(): WalletMode {
  return openWalletMode;
}

/**
 * Build an HD Wallet engine without touching walletSingleton.
 * Caller must dispose — never start notifyIncomingFunds on peek instances.
 */
async function createHdWalletEngine(
  walletId: string,
  opts: CreateEngineOpts = {},
): Promise<BasicWallet> {
  const mnemonic = await loadMnemonicForCrypto(walletId);
  if (!mnemonic) {
    throw new Error("No mnemonic in Keystore for wallet");
  }

  const network = getNetworkConfig();
  const storage = await ensurePersistentStorageReady(network.id, walletId);

  await Promise.all([
    storage.walletRepository.getWalletState().catch(() => null),
    ensureArkInfoSnapshotSeed(storage.walletRepository, network.id),
  ]);

  const identity = MnemonicIdentity.fromMnemonic(mnemonic, {
    isMainnet: network.isMainnet,
  });

  const delegateSettings = await readDelegateSettings();
  const delegateUrl = resolveDelegateUrl(network.id, delegateSettings);
  const delegateProvider = delegateUrl
    ? new RestDelegateProvider(delegateUrl)
    : undefined;

  const mode: WalletMode = opts.walletMode ?? "hd";

  const wallet = await withTimeout(
    Wallet.create({
      identity,
      walletMode: mode,
      arkProvider: new TimedExpoArkProvider(network.arkServerUrl),
      indexerProvider: new ExpoIndexerProvider(network.arkServerUrl),
      onchainProvider: new NoWatchEsploraProvider(network.esploraUrl),
      storage,
      ...(delegateProvider ? { delegateProvider } : {}),
      watcherConfig: {
        maxReconnectAttempts: 5,
        failsafePollIntervalMs: 120_000,
        reconnectDelayMs: 2_000,
        maxReconnectDelayMs: 30_000,
      },
      ...(network.id === "mutinynet" ? { minCheckpointExitDelaySeconds: 4096n } : {}),
    }),
    CREATE_TIMEOUT_MS,
    "Wallet.create",
  );

  if (opts.runRestore && mode === "hd") {
    await runWalletRestore(walletId, wallet);
  }

  return wallet;
}

async function disposeWalletEngine(wallet: BasicWallet): Promise<void> {
  const anyW = wallet as BasicWallet & {
    dispose?: () => Promise<void> | void;
    clear?: () => Promise<void> | void;
  };
  try {
    if (typeof anyW.dispose === "function") {
      await anyW.dispose();
      return;
    }
    if (typeof anyW.clear === "function") {
      await anyW.clear();
    }
  } catch (e) {
    console.warn("[basic] wallet dispose failed", e);
  }
}

export async function openHdWalletFromKeystore(
  walletId: string,
  opts: OpenWalletOpts = {},
): Promise<BasicWallet> {
  const wantMode: WalletMode = opts.walletMode ?? "hd";
  if (walletSingleton && openWalletId === walletId && openWalletMode === wantMode) {
    if (opts.runRestore && wantMode === "hd") {
      await runWalletRestore(walletId, walletSingleton);
    }
    return walletSingleton;
  }

  // Close previous engine reference (GC); SQLite files stay on disk.
  clearOpenWallet();

  const wallet = await createHdWalletEngine(walletId, {
    runRestore: opts.runRestore,
    walletMode: wantMode,
  });

  walletSingleton = wallet;
  openWalletId = walletId;
  openWalletMode = wantMode;

  return wallet;
}

const peekInflight = new Map<string, Promise<string>>();

/**
 * Ephemeral open of another registry wallet for getAddress only.
 * Does not assign walletSingleton / selected engine. Always dispose in finally.
 * No notifyIncomingFunds / waitFor* — address read only.
 */
export async function peekArkAddress(walletId: string): Promise<string> {
  if (openWalletId === walletId && walletSingleton) {
    return withTimeout(walletSingleton.getAddress(), 8_000, "peek.getAddress");
  }

  const inflight = peekInflight.get(walletId);
  if (inflight) return inflight;

  const p = (async () => {
    let ephemeral: BasicWallet | null = null;
    try {
      // No restore — HD receive index already on disk; getAddress is enough.
      ephemeral = await createHdWalletEngine(walletId, { runRestore: false });
      return await withTimeout(ephemeral.getAddress(), 8_000, "peek.getAddress");
    } finally {
      if (ephemeral) await disposeWalletEngine(ephemeral);
      peekInflight.delete(walletId);
    }
  })();

  peekInflight.set(walletId, p);
  return p;
}

export function runWalletRestore(
  walletId: string,
  wallet: BasicWallet = walletSingleton!,
): Promise<void> {
  if (!wallet) return Promise.resolve();
  if (restoreDone.has(walletId)) return Promise.resolve();
  const inflight = restorePromises.get(walletId);
  if (inflight) return inflight;
  const w = wallet as BasicWallet & { restore?: (opts: { gapLimit: number }) => Promise<void> };
  if (typeof w.restore !== "function") {
    restoreDone.add(walletId);
    return Promise.resolve();
  }
  const p = withTimeout(w.restore({ gapLimit: 20 }), 60_000, "wallet.restore")
    .catch((e) => {
      console.warn("[basic] wallet.restore failed", e);
    })
    .finally(() => {
      restoreDone.add(walletId);
      restorePromises.delete(walletId);
    });
  restorePromises.set(walletId, p);
  return p;
}

export function getOpenWallet(): BasicWallet | null {
  return walletSingleton;
}

export function getOpenWalletId(): string | null {
  return openWalletId;
}

export function clearOpenWallet(): void {
  walletSingleton = null;
  openWalletId = null;
  openWalletMode = "hd";
}
