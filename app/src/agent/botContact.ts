/**
 * Local Cursor bot contact helpers (stable id + field marker).
 */

import {
  createContactDraft,
  deleteContact,
  getContact,
  upsertContact,
} from "../contacts/contactStore";
import { deleteChatThreadLocal } from "../chat/chatStore";
import {
  contactDisplayName,
  newContactId,
  type Contact,
} from "../contacts/types";
import {
  CURSOR_AI_NAME,
  CURSOR_BOT_CONTACT_ID,
  CURSOR_BOT_FIELD_KEY,
  CURSOR_BOT_FIELD_VALUE,
} from "./botConstants";

export function isCursorBotContact(
  contact: Pick<Contact, "id" | "fields"> | null | undefined,
): boolean {
  if (!contact) return false;
  if (contact.id === CURSOR_BOT_CONTACT_ID) return true;
  return contact.fields.some(
    (f) =>
      f.key === CURSOR_BOT_FIELD_KEY &&
      f.value.trim().toLowerCase() === CURSOR_BOT_FIELD_VALUE,
  );
}

export function getCursorBotContact(): Contact | null {
  const c = getContact(CURSOR_BOT_CONTACT_ID);
  return c && isCursorBotContact(c) ? c : null;
}

export function upsertCursorBotContact(botNpub: string): Contact {
  const existing = getContact(CURSOR_BOT_CONTACT_ID);
  const now = Date.now();
  const draft = createContactDraft({
    name: CURSOR_AI_NAME,
    kind: "npub",
    value: botNpub.trim(),
  });
  const contact: Contact = {
    ...draft,
    id: CURSOR_BOT_CONTACT_ID,
    name: CURSOR_AI_NAME,
    note: "Your AI concierge — messages from strangers are ignored.",
    identifiers: [
      {
        id: existing?.identifiers.find((i) => i.kind === "npub")?.id ?? newContactId("id"),
        kind: "npub",
        value: botNpub.trim(),
      },
    ],
    fields: [
      {
        id:
          existing?.fields.find((f) => f.key === CURSOR_BOT_FIELD_KEY)?.id ??
          newContactId("f"),
        key: CURSOR_BOT_FIELD_KEY,
        value: CURSOR_BOT_FIELD_VALUE,
      },
    ],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return upsertContact(contact, { sync: false });
}

export function removeCursorBotContactAndThread(): void {
  try {
    deleteChatThreadLocal(CURSOR_BOT_CONTACT_ID);
  } catch {
    /* */
  }
  try {
    deleteContact(CURSOR_BOT_CONTACT_ID, { sync: false });
  } catch {
    /* */
  }
}

export function cursorBotAskTitle(contact?: Contact | null): string {
  const name = contact ? contactDisplayName(contact) : CURSOR_AI_NAME;
  const trimmed = name.trim() || CURSOR_AI_NAME;
  if (trimmed.toLowerCase().startsWith("ask ")) return trimmed;
  return `Ask ${trimmed}`;
}
