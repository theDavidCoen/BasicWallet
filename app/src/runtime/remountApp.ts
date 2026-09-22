/**
 * Soft app remount after network switch — avoids native reloadAppAsync
 * (debug builds lose Metro / show "Unable to load script").
 */

import { clearOpenWallet } from "../wallet/hdWallet";

type RemountFn = () => void;

let remountHandler: RemountFn | null = null;

export function registerAppRemount(fn: RemountFn): () => void {
  remountHandler = fn;
  return () => {
    if (remountHandler === fn) remountHandler = null;
  };
}

/** Persist prefs first, then call this to remount WalletProvider + navigation. */
export function remountAppForNetworkSwitch(): void {
  clearOpenWallet();
  if (!remountHandler) {
    throw new Error("App remount not registered");
  }
  remountHandler();
}
