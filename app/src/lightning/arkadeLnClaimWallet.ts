/**
 * HD wallets fail swap v2 receive mint:
 *   wallet cannot sign deterministically for tr([fp/86'/0'/0']xpub/0/N); its preimage is not derivable
 *
 * Official arkade.money defaults to walletMode "static" (salted tr(pubkey) + stored-P fallback).
 * Wrap the wallet so LN claim secrets use that arm. Payout still uses HD getAddress().
 */
import type { IWallet } from "@arkade-os/sdk";

function errorText(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause;
    const extra = cause ? ` | cause: ${errorText(cause)}` : "";
    return `${err.message}${extra}`;
  }
  return String(err);
}

export function isHdPreimageError(err: unknown): boolean {
  return /preimage is not derivable|cannot sign deterministically/i.test(
    errorText(err),
  );
}

export function formatLnError(err: unknown): string {
  return errorText(err);
}

type DeterministicHdIdentity = {
  signSchnorrDeterministicWithDescriptor?: (
    descriptor: string,
    messageHash: Uint8Array,
  ) => Promise<Uint8Array>;
  signSchnorrDeterministic?: (messageHash: Uint8Array) => Promise<Uint8Array>;
};

type LnClaimWallet = IWallet & {
  signerForDescriptor?: (descriptor: string) => Promise<{
    xOnlyPublicKey?: () => Promise<Uint8Array>;
    signSchnorrDeterministic?: (messageHash: Uint8Array) => Promise<Uint8Array>;
  }>;
  getNextSigningDescriptor?: () => Promise<string | undefined>;
  advanceSigningDescriptorWatermark?: (descriptor: string) => Promise<void>;
};

export function withArkadeLnClaimWallet(wallet: IWallet): IWallet {
  const host = wallet as LnClaimWallet;
  const identity = wallet.identity as DeterministicHdIdentity;
  const origSigner =
    typeof host.signerForDescriptor === "function"
      ? host.signerForDescriptor.bind(wallet)
      : null;

  return new Proxy(wallet, {
    get(target, prop, receiver) {
      if (
        prop === "getNextSigningDescriptor" ||
        prop === "advanceSigningDescriptorWatermark"
      ) {
        return undefined;
      }
      if (prop === "signerForDescriptor") {
        return async (descriptor: string) => {
          const inner = origSigner
            ? await origSigner(descriptor)
            : target.identity;
          const viaIdentity = async (messageHash: Uint8Array) => {
            if (
              typeof identity.signSchnorrDeterministicWithDescriptor ===
              "function"
            ) {
              try {
                return await identity.signSchnorrDeterministicWithDescriptor(
                  descriptor,
                  messageHash,
                );
              } catch {
                // identityDescriptor() is tr(pubkey), not an HD child.
              }
            }
            if (typeof identity.signSchnorrDeterministic === "function") {
              return identity.signSchnorrDeterministic(messageHash);
            }
            throw new Error(
              `wallet cannot sign deterministically for ${descriptor}; its preimage is not derivable`,
            );
          };
          if (!inner || typeof inner !== "object") {
            return {
              xOnlyPublicKey: () => target.identity.xOnlyPublicKey(),
              signSchnorrDeterministic: viaIdentity,
            };
          }
          return new Proxy(inner as object, {
            get(t, p, r) {
              if (p === "signSchnorrDeterministic") {
                return async (messageHash: Uint8Array) => {
                  const native = (
                    t as {
                      signSchnorrDeterministic?: (
                        h: Uint8Array,
                      ) => Promise<Uint8Array>;
                    }
                  ).signSchnorrDeterministic;
                  if (typeof native === "function") {
                    try {
                      return await native.call(t, messageHash);
                    } catch (e) {
                      if (isHdPreimageError(e)) return viaIdentity(messageHash);
                      throw e;
                    }
                  }
                  return viaIdentity(messageHash);
                };
              }
              const val = Reflect.get(t, p, r);
              return typeof val === "function"
                ? (val as (...a: unknown[]) => unknown).bind(t)
                : val;
            },
          });
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as IWallet;
}
