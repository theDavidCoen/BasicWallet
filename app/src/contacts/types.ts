/**
 * Private contacts directory — local SQLCipher + Nostr NIP-44 sync.
 * Never stores OS contacts; never stores mnemonics.
 */

export type IdentifierKind =
  | "ark"
  | "onchain"
  | "npub"
  | "nip05"
  | "lnurl"
  | "lightning_address"
  | "bip353"
  | "custom";

export type ResolvedHint = {
  at: number;
  kind: string;
  value: string;
  note?: string;
};

export type ContactIdentifier = {
  id: string;
  kind: IdentifierKind;
  value: string;
  label?: string;
  customKindLabel?: string;
  lastResolved?: ResolvedHint;
};

export type ContactField = {
  id: string;
  key: string;
  value: string;
};

export type Contact = {
  id: string;
  name: string;
  surname?: string;
  note?: string;
  identifiers: ContactIdentifier[];
  fields: ContactField[];
  createdAt: number;
  updatedAt: number;
};

export const IDENTIFIER_KIND_LABELS: Record<IdentifierKind, string> = {
  ark: "Ark",
  onchain: "On-chain",
  lightning_address: "LN Address",
  bip353: "BIP 353",
  lnurl: "LNURL",
  npub: "npub",
  nip05: "NIP-05",
  custom: "Custom",
};

/** Dropdown order (Penpot / plan). */
export const IDENTIFIER_KIND_ORDER: IdentifierKind[] = [
  "ark",
  "onchain",
  "lightning_address",
  "bip353",
  "lnurl",
  "npub",
  "nip05",
  "custom",
];

export function newContactId(prefix = "c"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function kindPillLabel(id: ContactIdentifier): string {
  if (id.kind === "custom" && id.customKindLabel?.trim()) {
    return id.customKindLabel.trim().slice(0, 12);
  }
  return IDENTIFIER_KIND_LABELS[id.kind];
}

/** Prefer ark → LN kinds → nip05/npub → onchain → first. */
export function primaryIdentifier(contact: Contact): ContactIdentifier | null {
  const ids = contact.identifiers;
  if (!ids.length) return null;
  const order: IdentifierKind[] = [
    "ark",
    "lightning_address",
    "bip353",
    "lnurl",
    "nip05",
    "npub",
    "onchain",
    "custom",
  ];
  for (const k of order) {
    const hit = ids.find((i) => i.kind === k);
    if (hit) return hit;
  }
  return ids[0] ?? null;
}

export function midEllipsis(s: string, left = 10, right = 6): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

/** Display name: "Name Surname" or just name/username. */
export function contactDisplayName(contact: Pick<Contact, "name" | "surname">): string {
  const n = contact.name.trim();
  const s = contact.surname?.trim() ?? "";
  return s ? `${n} ${s}` : n;
}

/** Avatar initials from name + surname (1–2 letters). */
export function contactInitials(contact: Pick<Contact, "name" | "surname">): string {
  const n = contact.name.trim();
  const s = contact.surname?.trim() ?? "";
  const a = n ? n[0]!.toUpperCase() : "";
  const b = s ? s[0]!.toUpperCase() : "";
  const out = `${a}${b}`;
  return out || "?";
}
