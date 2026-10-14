/**
 * Dirty flags for activity rematerialize — open Activity only rematerializes
 * when dirty, force (pull), or notify/send marked the wallet.
 */

export type ActivityDirtyReason =
  | "local_send"
  | "local_receive"
  | "notify"
  | "wallet_switch"
  | "import_restore"
  | "force"
  | "pay_in_chat"
  | "other";

const dirty = new Map<string, ActivityDirtyReason>();

export function markActivityDirty(
  walletId: string,
  reason: ActivityDirtyReason,
): void {
  if (!walletId) return;
  dirty.set(walletId, reason);
  console.log(
    `[activityDirty] mark wallet=${walletId.slice(0, 8)} reason=${reason}`,
  );
}

/** Returns true if dirty was set (and clears it). */
export function consumeActivityDirty(walletId: string): boolean {
  if (!walletId) return false;
  if (!dirty.has(walletId)) return false;
  const reason = dirty.get(walletId);
  dirty.delete(walletId);
  console.log(
    `[activityDirty] consume wallet=${walletId.slice(0, 8)} reason=${reason}`,
  );
  return true;
}

export function isActivityDirty(walletId: string): boolean {
  return dirty.has(walletId);
}

/** Peek without consume (tests / debug). */
export function peekActivityDirty(
  walletId: string,
): ActivityDirtyReason | null {
  return dirty.get(walletId) ?? null;
}
