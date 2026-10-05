/**
 * Tracks whether ChatThread is focused so WalletProvider can suppress the classic
 * FundsReceived overlay. Chat already shows “You received…” payment cards.
 * Also used so inbound ingest does not bump unread for the open thread.
 */

let focusedContactId: string | null = null;

export function setChatThreadFocused(on: boolean, contactId?: string | null): void {
  if (on && contactId) {
    focusedContactId = contactId;
    return;
  }
  focusedContactId = null;
}

export function isChatThreadFocused(): boolean {
  return focusedContactId != null;
}

export function getFocusedChatContactId(): string | null {
  return focusedContactId;
}
