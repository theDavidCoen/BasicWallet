/**
 * Sync gate so WalletProvider can suppress sats-dust FundsReceived while Fiat Mode
 * is on (DePix arrives with 330 carrier sats). Updated by FiatModeProvider.
 */

let active = false;

export function setFiatModeActiveGate(on: boolean): void {
  active = Boolean(on);
}

export function isFiatModeActiveGate(): boolean {
  return active;
}
