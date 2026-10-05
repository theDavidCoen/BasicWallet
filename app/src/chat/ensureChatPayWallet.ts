/**
 * Resolve the selected Arkade wallet + open engine for chat Pay / Send.
 * Home can show a cached balance while React `wallet` is still null; Pay must
 * reopen the selected Personal (or other Arkade) wallet instead of failing.
 */

import type { WalletRecord } from "../account/walletRegistry";
import {
  getOpenWallet,
  getOpenWalletId,
  openHdWalletFromKeystore,
  type BasicWallet,
} from "../wallet/hdWallet";

export type EnsureChatPayWalletOk = {
  ok: true;
  wallet: BasicWallet;
  walletId: string;
  selected: WalletRecord;
};

export type EnsureChatPayWalletErr = {
  ok: false;
  message: string;
};

export async function ensureChatPayWallet(opts: {
  wallet: BasicWallet | null;
  selectedWallet: WalletRecord | null;
}): Promise<EnsureChatPayWalletOk | EnsureChatPayWalletErr> {
  const selected = opts.selectedWallet;
  if (!selected || selected.kind !== "arkade") {
    return { ok: false, message: "Select an Arkade wallet to send." };
  }
  const walletId = selected.id;

  if (opts.wallet && getOpenWalletId() === walletId) {
    return { ok: true, wallet: opts.wallet, walletId, selected };
  }

  const open = getOpenWallet();
  if (open && getOpenWalletId() === walletId) {
    return { ok: true, wallet: open, walletId, selected };
  }

  try {
    const wallet = await openHdWalletFromKeystore(walletId, { runRestore: false });
    return { ok: true, wallet, walletId, selected };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error ? e.message : "Could not open the selected Arkade wallet.",
    };
  }
}
