/**
 * BIP353 resolve for contacts — wraps Lightning probe so UI gets clear errors.
 */

import { probeLightningPay, type LnPayProbe } from "../lightning/lnPayResolve";
import type { ResolvedHint } from "./types";

export type Bip353ResolveOk = {
  ok: true;
  probe: LnPayProbe;
  /** Value to put in the Send destination field. */
  payDestination: string;
  hint: ResolvedHint;
};

export type Bip353ResolveErr = {
  ok: false;
  message: string;
};

export type Bip353ResolveResult = Bip353ResolveOk | Bip353ResolveErr;

export async function resolveBip353ForContacts(
  raw: string,
  mode: "arkade" | "lightning",
): Promise<Bip353ResolveResult> {
  const display = raw.trim().replace(/^₿/, "");
  if (!display.includes("@")) {
    return { ok: false, message: "BIP353 must look like user@domain (optional ₿ prefix)." };
  }

  let probe: LnPayProbe;
  try {
    probe = await probeLightningPay(raw.startsWith("₿") ? raw : `₿${display}`);
  } catch (e) {
    // Retry without forcing ₿ — probe tries BIP353 then LNURL-p
    try {
      probe = await probeLightningPay(display);
    } catch (e2) {
      return {
        ok: false,
        message:
          e2 instanceof Error
            ? e2.message
            : "BIP353 / address lookup failed.",
      };
    }
  }

  if (probe.kind === "bip353" || probe.kind === "lightning-address" || probe.kind === "lnurl") {
    if (mode === "arkade") {
      return {
        ok: false,
        message:
          "BIP353 resolved to a Lightning payment, but this Arkade wallet can’t pay Lightning here. Switch to a Lightning wallet or add an ark… identifier.",
      };
    }
    const payDestination =
      probe.bolt11 ??
      (probe.kind === "lightning-address" || probe.kind === "bip353" ? display : raw.trim());
    return {
      ok: true,
      probe,
      payDestination,
      hint: {
        at: Date.now(),
        kind: probe.kind,
        value: probe.bolt11 ?? display,
        note: probe.description,
      },
    };
  }

  if (probe.kind === "bolt12") {
    return {
      ok: false,
      message:
        "BIP353 resolved to a BOLT12 offer only. This connection can’t pay BOLT12 yet — use an address that issues BOLT11.",
    };
  }

  if (probe.kind === "bolt11" && probe.bolt11) {
    if (mode === "arkade") {
      return {
        ok: false,
        message: "BIP353 resolved to a BOLT11 invoice, which this Arkade wallet can’t pay.",
      };
    }
    return {
      ok: true,
      probe,
      payDestination: probe.bolt11,
      hint: {
        at: Date.now(),
        kind: "bolt11",
        value: probe.bolt11,
        note: "BIP353",
      },
    };
  }

  return {
    ok: false,
    message: "BIP353 resolved, but no compatible payment type was found for this wallet.",
  };
}
