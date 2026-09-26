/**
 * Sync gate so WalletProvider can suppress sats-dust FundsReceived while Fiat Mode
 * is on (DePix arrives with 330 carrier sats). Updated by FiatModeProvider.
 *
 * Conversion quiet: after Enter, suppress BRL receive toasts for the swap fill;
 * after Exit, suppress sats receive toasts for the swap fill. Real inbound
 * payments outside that window still toast.
 *
 * Optimistic DePix: FiatModeProvider registers spend/receive so WalletProvider /
 * Send can update Home without waiting for getBalance (avoids flash 0 / overshoot).
 */

let active = false;
/** Epoch ms — suppress BRL FundsReceived (enter swap fill). */
let suppressBrlUntil = 0;
/** Epoch ms — suppress arkade/sats FundsReceived (exit swap fill). */
let suppressSatsUntil = 0;

type DepixOptimisticHandlers = {
  spend: (displayAmount: number) => void;
  receive: (displayAmount: number) => void;
};

let depixOptimistic: DepixOptimisticHandlers | null = null;

export function setFiatModeActiveGate(on: boolean): void {
  active = Boolean(on);
}

export function isFiatModeActiveGate(): boolean {
  return active;
}

/** After Enter conversion fills — no BRL “Funds Received” for the swap itself. */
export function quietFiatEnterNotices(ms = 45_000): void {
  suppressBrlUntil = Date.now() + Math.max(0, ms);
}

/** After Exit conversion fills — no sats “Funds Received” for the swap itself. */
export function quietFiatExitNotices(ms = 45_000): void {
  suppressSatsUntil = Date.now() + Math.max(0, ms);
}

export function shouldSuppressFiatEnterBrlNotice(): boolean {
  return Date.now() < suppressBrlUntil;
}

export function shouldSuppressFiatExitSatsNotice(): boolean {
  return Date.now() < suppressSatsUntil;
}

export function registerFiatDepixOptimistic(
  handlers: DepixOptimisticHandlers | null,
): void {
  depixOptimistic = handlers;
}

export function optimisticDepixSpend(displayAmount: number): void {
  if (!(displayAmount > 0)) return;
  depixOptimistic?.spend(displayAmount);
}

export function optimisticDepixReceive(displayAmount: number): void {
  if (!(displayAmount > 0)) return;
  depixOptimistic?.receive(displayAmount);
}
