/** Steps inside the single Wallets bottom sheet (list → edit/add/import/connect). */

export type WalletFlowStep =
  | "list"
  | "edit"
  | "add"
  | "import"
  | "connect-menu"
  | "connect-lndhub"
  | "connect-btcpay"
  | "connect-status";

export function isConnectWalletStep(step: WalletFlowStep): boolean {
  return (
    step === "connect-menu" ||
    step === "connect-lndhub" ||
    step === "connect-btcpay" ||
    step === "connect-status"
  );
}
