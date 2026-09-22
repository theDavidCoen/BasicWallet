/** Shared Connect Node sheet-flow types (menu → provider → status). */

export type ConnectFlowStep = "menu" | "lndhub" | "btcpay" | "status";

export type ConnectProviderStep = "lndhub" | "btcpay";

export type NodeStatusPayload = {
  localSats?: number;
  alias?: string;
  pubkey?: string;
};
