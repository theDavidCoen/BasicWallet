/**
 * Bottom sheet: share contact via Nostr (pick from contacts or paste npub / NIP-05).
 */

import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { filterContacts } from "../../contacts/contactSearch";
import { shareContactToRecipient } from "../../contacts/contactShare";
import { listContacts } from "../../contacts/contactStore";
import type { Contact } from "../../contacts/types";
import { contactDisplayName, midEllipsis } from "../../contacts/types";
import { hasNostrIdentity } from "../../nostr/identityStore";
import { InteractiveBottomSheet } from "../sheet/InteractiveBottomSheet";
import { colors } from "../../theme/colors";
import { sheetUi } from "../../theme/sheetUi";
import { ContactPickList } from "./ContactPickList";

/** Prefer NIP-05, then npub — values usable by shareContactToRecipient. */
export function nostrShareTarget(contact: Contact): string | null {
  const nip05 = contact.identifiers.find(
    (i) => i.kind === "nip05" && i.value.trim(),
  );
  if (nip05) return nip05.value.trim();
  const npub = contact.identifiers.find(
    (i) => i.kind === "npub" && i.value.trim().toLowerCase().startsWith("npub1"),
  );
  if (npub) return npub.value.trim();
  return null;
}

function looksLikeManualNostr(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (!t) return false;
  if (t.startsWith("npub1")) return true;
  if (t.includes("@") && !t.includes(" ")) return true;
  return false;
}

export function ShareContactSheet({
  open,
  onDismiss,
  contact,
}: {
  open: boolean;
  onDismiss: () => void;
  contact: Contact;
}) {
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allContacts = useMemo(() => (open ? listContacts() : []), [open]);

  const nostrContacts = useMemo(() => {
    return allContacts.filter(
      (c) => c.id !== contact.id && !!nostrShareTarget(c),
    );
  }, [allContacts, contact.id]);

  const filtered = useMemo(
    () => filterContacts(nostrContacts, query),
    [nostrContacts, query],
  );

  const picked = useMemo(
    () => (pickedId ? nostrContacts.find((c) => c.id === pickedId) ?? null : null),
    [pickedId, nostrContacts],
  );

  const recipientRaw = useMemo(() => {
    if (picked) return nostrShareTarget(picked) ?? "";
    if (looksLikeManualNostr(query)) return query.trim();
    return "";
  }, [picked, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setPickedId(null);
      setBusy(false);
    }
  }, [open]);

  async function onSend() {
    const raw = recipientRaw.trim();
    if (!raw) {
      Alert.alert(
        "Recipient required",
        "Pick a contact with npub or NIP-05, or paste one below.",
      );
      return;
    }
    if (!(await hasNostrIdentity())) {
      Alert.alert(
        "Nostr identity needed",
        "Create or import a Nostr identity in Settings before sharing contacts.",
      );
      return;
    }
    setBusy(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const result = await shareContactToRecipient(contact, raw, { signal: ctrl.signal });
      const toLabel = picked
        ? contactDisplayName(picked)
        : midEllipsis(result.recipientNpub);
      Alert.alert(
        "Shared",
        `Sent “${contactDisplayName(contact)}” to ${toLabel} via Nostr.`,
      );
      onDismiss();
    } catch (e) {
      Alert.alert("Share failed", e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  function onPick(c: Contact) {
    setPickedId(c.id);
    setQuery("");
  }

  const canSend = !!recipientRaw.trim() && !busy;

  return (
    <InteractiveBottomSheet
      open={open}
      onDismiss={onDismiss}
      visibleFraction={0.78}
      avoidKeyboard
      portal
    >
      <View style={styles.body}>
        <Text style={sheetUi.title}>SHARE CONTACT</Text>
        <Text style={sheetUi.caption} numberOfLines={2}>
          {contactDisplayName(contact)}
        </Text>
        <Text style={sheetUi.hint}>
          Pick a contact with npub or NIP-05, or paste one.
        </Text>

        <TextInput
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (pickedId) setPickedId(null);
          }}
          placeholder="Search contacts or paste npub / NIP-05"
          placeholderTextColor={colors.hint}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          style={sheetUi.input}
        />

        {picked ? (
          <View style={styles.pickedBanner}>
            <Text style={styles.pickedLabel}>To</Text>
            <Text style={styles.pickedName} numberOfLines={1}>
              {contactDisplayName(picked)}
            </Text>
            <Text style={styles.pickedTarget} numberOfLines={1}>
              {midEllipsis(recipientRaw, 14, 8)}
            </Text>
            <Pressable
              onPress={() => setPickedId(null)}
              hitSlop={8}
              accessibilityLabel="Clear recipient"
            >
              <Text style={styles.pickedClear}>Clear</Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          style={styles.scroll}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          <ContactPickList
            contacts={filtered}
            onPick={onPick}
            emptyLabel={
              nostrContacts.length === 0
                ? "No contacts with npub or NIP-05 yet"
                : query.trim()
                  ? "No matches"
                  : "No contacts"
            }
          />
        </ScrollView>

        <Pressable
          style={[sheetUi.primaryBtn, !canSend && { opacity: 0.5 }]}
          disabled={!canSend}
          onPress={() => void onSend()}
          accessibilityRole="button"
          accessibilityLabel="Send contact"
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={sheetUi.primaryBtnText}>Send</Text>
          )}
        </Pressable>
      </View>
    </InteractiveBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingBottom: 12,
  },
  scroll: {
    flexGrow: 0,
    maxHeight: 280,
    marginBottom: 8,
  },
  pickedBanner: {
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 2,
  },
  pickedLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
  },
  pickedName: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  pickedTarget: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  pickedClear: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 6,
  },
});
