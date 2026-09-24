/**
 * Contacts CRUD in account SQLCipher (mainnet account DB — shared across networks).
 */

import { getAccountDb } from "../account/accountDb";
import type { ArkadeNetworkId } from "../config/network";
import {
  type Contact,
  type ContactField,
  type ContactIdentifier,
  type IdentifierKind,
  type ResolvedHint,
  newContactId,
} from "./types";

function queueSync(reason: string): void {
  void import("./contactsNostrSync").then((m) => {
    m.queuePublishContactsDirectory(reason);
  });
}

/** Contacts live in the mainnet account file so they survive network switches. */
const CONTACTS_NETWORK: ArkadeNetworkId = "mainnet";

function db() {
  return getAccountDb(CONTACTS_NETWORK);
}

type ContactRow = {
  id: string;
  name: string;
  note: string | null;
  created_at: number;
  updated_at: number;
};

type IdentRow = {
  id: string;
  contact_id: string;
  kind: string;
  value: string;
  label: string | null;
  custom_kind_label: string | null;
  last_resolved_json: string | null;
  sort_order: number;
};

type FieldRow = {
  id: string;
  contact_id: string;
  key: string;
  value: string;
  sort_order: number;
};

function parseResolved(raw: string | null): ResolvedHint | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as ResolvedHint;
    if (typeof p.at === "number" && typeof p.kind === "string" && typeof p.value === "string") {
      return p;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function rowToContact(
  row: ContactRow,
  idents: IdentRow[],
  fields: FieldRow[],
): Contact {
  return {
    id: row.id,
    name: row.name,
    note: row.note?.trim() ? row.note : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    identifiers: idents
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({
        id: i.id,
        kind: i.kind as IdentifierKind,
        value: i.value,
        label: i.label?.trim() ? i.label : undefined,
        customKindLabel: i.custom_kind_label?.trim() ? i.custom_kind_label : undefined,
        lastResolved: parseResolved(i.last_resolved_json),
      })),
    fields: fields
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => ({
        id: f.id,
        key: f.key,
        value: f.value,
      })),
  };
}

function loadContact(id: string): Contact | null {
  const database = db();
  const row = database.getFirstSync<ContactRow>(
    `SELECT id, name, note, created_at, updated_at FROM contacts WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  const idents = database.getAllSync<IdentRow>(
    `SELECT * FROM contact_identifiers WHERE contact_id = ?`,
    [id],
  );
  const fields = database.getAllSync<FieldRow>(
    `SELECT * FROM contact_fields WHERE contact_id = ?`,
    [id],
  );
  return rowToContact(row, idents, fields);
}

export function listContacts(): Contact[] {
  const database = db();
  const rows = database.getAllSync<ContactRow>(
    `SELECT id, name, note, created_at, updated_at FROM contacts ORDER BY name COLLATE NOCASE ASC`,
  );
  return rows
    .map((r) => loadContact(r.id))
    .filter((c): c is Contact => c != null);
}

export function getContact(id: string): Contact | null {
  return loadContact(id);
}

export function findContactByIdentifierValue(value: string): Contact | null {
  const v = value.trim();
  if (!v) return null;
  const database = db();
  const row = database.getFirstSync<{ contact_id: string }>(
    `SELECT contact_id FROM contact_identifiers WHERE lower(value) = lower(?) LIMIT 1`,
    [v],
  );
  if (!row) return null;
  return loadContact(row.contact_id);
}

function replaceChildren(contact: Contact): void {
  const database = db();
  database.runSync(`DELETE FROM contact_identifiers WHERE contact_id = ?`, [contact.id]);
  database.runSync(`DELETE FROM contact_fields WHERE contact_id = ?`, [contact.id]);
  contact.identifiers.forEach((ident, i) => {
    database.runSync(
      `INSERT INTO contact_identifiers
        (id, contact_id, kind, value, label, custom_kind_label, last_resolved_json, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ident.id,
        contact.id,
        ident.kind,
        ident.value.trim(),
        ident.label?.trim() || null,
        ident.customKindLabel?.trim() || null,
        ident.lastResolved ? JSON.stringify(ident.lastResolved) : null,
        i,
      ],
    );
  });
  contact.fields.forEach((field, i) => {
    database.runSync(
      `INSERT INTO contact_fields (id, contact_id, key, value, sort_order) VALUES (?, ?, ?, ?, ?)`,
      [field.id, contact.id, field.key.trim(), field.value, i],
    );
  });
}

function assertContact(contact: Contact): void {
  if (!contact.name.trim()) throw new Error("Name is required");
  if (!contact.identifiers.length) throw new Error("At least one identifier is required");
  for (const id of contact.identifiers) {
    if (!id.value.trim()) throw new Error("Identifier value cannot be empty");
    if (id.kind === "custom" && !id.customKindLabel?.trim()) {
      throw new Error("Custom identifiers need a type label");
    }
  }
}

export function upsertContact(input: Contact, opts?: { sync?: boolean }): Contact {
  assertContact(input);
  const now = Date.now();
  const existing = loadContact(input.id);
  const contact: Contact = {
    ...input,
    name: input.name.trim(),
    note: input.note?.trim() || undefined,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };

  const database = db();
  database.runSync(
    `INSERT OR REPLACE INTO contacts (id, name, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    [contact.id, contact.name, contact.note ?? null, contact.createdAt, contact.updatedAt],
  );
  replaceChildren(contact);

  if (opts?.sync !== false) {
    queueSync("upsert");
  }
  return contact;
}

export function deleteContact(id: string, opts?: { sync?: boolean }): void {
  const database = db();
  database.runSync(`DELETE FROM contact_identifiers WHERE contact_id = ?`, [id]);
  database.runSync(`DELETE FROM contact_fields WHERE contact_id = ?`, [id]);
  database.runSync(`DELETE FROM contacts WHERE id = ?`, [id]);
  if (opts?.sync !== false) {
    queueSync("delete");
  }
}

/** Replace entire local directory (Nostr fetch / restore). Does not publish. */
export function replaceAllContacts(contacts: Contact[]): void {
  const database = db();
  database.execSync(`DELETE FROM contact_identifiers;`);
  database.execSync(`DELETE FROM contact_fields;`);
  database.execSync(`DELETE FROM contacts;`);
  for (const c of contacts) {
    try {
      assertContact(c);
    } catch {
      continue;
    }
    database.runSync(
      `INSERT INTO contacts (id, name, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [c.id, c.name.trim(), c.note?.trim() || null, c.createdAt, c.updatedAt],
    );
    replaceChildren({
      ...c,
      name: c.name.trim(),
      note: c.note?.trim() || undefined,
    });
  }
}

export function wipeContactsTables(): void {
  const database = db();
  try {
    database.execSync(`DELETE FROM contact_identifiers;`);
    database.execSync(`DELETE FROM contact_fields;`);
    database.execSync(`DELETE FROM contacts;`);
  } catch {
    /* tables may not exist yet */
  }
}

export function createEmptyIdentifier(
  kind: IdentifierKind = "ark",
  value = "",
): ContactIdentifier {
  return {
    id: newContactId("id"),
    kind,
    value,
  };
}

export function createEmptyField(): ContactField {
  return {
    id: newContactId("f"),
    key: "",
    value: "",
  };
}

export function createContactDraft(partial?: {
  name?: string;
  kind?: IdentifierKind;
  value?: string;
}): Contact {
  const now = Date.now();
  return {
    id: newContactId("c"),
    name: partial?.name?.trim() || "",
    identifiers: [
      createEmptyIdentifier(partial?.kind ?? "ark", partial?.value?.trim() || ""),
    ],
    fields: [],
    createdAt: now,
    updatedAt: now,
  };
}
