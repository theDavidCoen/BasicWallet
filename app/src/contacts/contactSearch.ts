import type { Contact } from "./types";

function fold(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

export function contactMatchesQuery(contact: Contact, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  if (fold(contact.name).includes(q)) return true;
  if (contact.note && fold(contact.note).includes(q)) return true;
  for (const id of contact.identifiers) {
    if (fold(id.value).includes(q)) return true;
    if (id.label && fold(id.label).includes(q)) return true;
    if (id.customKindLabel && fold(id.customKindLabel).includes(q)) return true;
  }
  for (const f of contact.fields) {
    if (fold(f.key).includes(q) || fold(f.value).includes(q)) return true;
  }
  return false;
}

export function filterContacts(contacts: Contact[], query: string): Contact[] {
  if (!query.trim()) return contacts;
  return contacts.filter((c) => contactMatchesQuery(c, query));
}
