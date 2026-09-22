import { BIP21 } from "@arkade-os/sdk";

/** Unified BIP21: boarding on-chain + Arkade (`ark=`). Optional amount in sats. */
export function encodeReceiveBip21(
  boarding: string | null,
  ark: string | null,
  lightningInvoice?: string | null,
  amountSats?: number | null,
): string | null {
  if (!boarding && !ark) return null;
  const amountBtc =
    amountSats != null && amountSats > 0 ? amountSats / 100_000_000 : undefined;
  return BIP21.create({
    address: boarding ?? undefined,
    ark: ark ?? undefined,
    ...(amountBtc != null ? { amount: amountBtc } : {}),
    ...(lightningInvoice ? { lightning: lightningInvoice } : {}),
  });
}
