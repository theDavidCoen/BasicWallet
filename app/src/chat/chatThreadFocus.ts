/**
 * Tracks whether ChatThread is focused so WalletProvider can suppress the classic
 * FundsReceived overlay. Chat already shows “You received…” payment cards.
 * Balance refresh / chat ingest stay unchanged — UI notice only.
 */

let focused = false;

export function setChatThreadFocused(on: boolean): void {
  focused = Boolean(on);
}

export function isChatThreadFocused(): boolean {
  return focused;
}
