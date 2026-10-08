/**
 * Resolve the selected spend wallet for chat Pay / Send.
 * Arkade: reopen engine when Home only has a cached balance.
 * Lightning (LNDhub): verify admin credentials (no HD engine).
 */

import type { WalletRecord } from "../account/walletRegistry";
import { loadLndHubCredentials } from "../lightning/lndhubCredentials";
import {
  getOpenWallet,
  getOpenWalletId,
  openHdWalletFromKeystore,
  type BasicWallet,
} from "../wallet/hdWallet";

export type EnsureChatPayWalletOk =
  | {
      ok: true;
      kind: "arkade";
      wallet: BasicWallet;
      walletId: string;
      selected: WalletRecord;
    }
  | {
      ok: true;
      kind: "lightning";
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
  if (!selected) {
    return { ok: false, message: "Select a wallet to send." };
  }

  if (selected.kind === "lightning") {
    const hub = await loadLndHubCredentials(selected.id);
    if (!hub) {
      return {
        ok: false,
        message: "Connect a Lightning node for this wallet first.",
      };
    }
    if (hub.role === "invoice") {
      return {
        ok: false,
        message:
          "This Lightning connection is invoice-only. Reconnect with an admin LNDHub URL to send.",
      };
    }
    return {
      ok: true,
      kind: "lightning",
      walletId: selected.id,
      selected,
    };
  }

  if (selected.kind !== "arkade") {
    return {
      ok: false,
      message: "Select an Arkade or Lightning wallet to send.",
    };
  }

  const walletId = selected.id;

  if (opts.wallet && getOpenWalletId() === walletId) {
    return { ok: true, kind: "arkade", wallet: opts.wallet, walletId, selected };
  }

  const open = getOpenWallet();
  if (open && getOpenWalletId() === walletId) {
    return { ok: true, kind: "arkade", wallet: open, walletId, selected };
  }

  try {
    const wallet = await openHdWalletFromKeystore(walletId, {
      runRestore: false,
    });
    return { ok: true, kind: "arkade", wallet, walletId, selected };
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "Could not open the selected Arkade wallet.",
    };
  }
}
