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
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allContacts = useMemo(() => (open ? listContacts() : []), [open]);

  /** Everyone except the contact being shared (show muted rows without Nostr id). */
  const candidates = useMemo(
    () => allContacts.filter((c) => c.id !== contact.id),
    [allContacts, contact.id],
  );

  const filtered = useMemo(
    () => filterContacts(candidates, query),
    [candidates, query],
  );

  const picked = useMemo(
    () => (pickedId ? candidates.find((c) => c.id === pickedId) ?? null : null),
    [pickedId, candidates],
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
        "Pick a contact with npub or NIP-05, or paste one in the search field.",
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
      const relayNote =
        result.failedRelays.length > 0
          ? `\nPublished to ${result.okRelays.length} relay(s); ${result.failedRelays.length} failed.`
          : "";
      Alert.alert(
        "Shared",
        `Sent “${contactDisplayName(contact)}” to ${toLabel} via Nostr.${relayNote}`,
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
    if (!nostrShareTarget(c)) {
      Alert.alert(
        "No Nostr address",
        "Add an npub or NIP-05 to this contact before sharing with them.",
      );
      return;
    }
    setPickedId(c.id);
    setQuery("");
  }

  const canSend = !!recipientRaw.trim() && !busy;
  // InteractiveBottomSheet already pads for the system nav; keep a small gap only.
  const footerPad = Math.max(8, Math.min(insets.bottom, 12));

  return (
    <InteractiveBottomSheet
      open={open}
      onDismiss={onDismiss}
      visibleFraction={0.92}
      avoidKeyboard
      portal
    >
      <View style={styles.body}>
        <Text style={sheetUi.title}>SHARE CONTACT</Text>
        <Text style={[sheetUi.caption, { marginBottom: 8 }]} numberOfLines={2}>
          {contactDisplayName(contact)}
        </Text>
        <Text style={[sheetUi.hint, { marginBottom: 12 }]}>
          Pick a contact (needs npub or NIP-05) or paste one.
        </Text>

        <TextInput
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            if (pickedId) setPickedId(null);
          }}
          placeholder="Search or paste npub"
          placeholderTextColor={colors.hint}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          numberOfLines={1}
          style={styles.search}
        />

        {picked ? (
          <View style={styles.pickedBanner}>
            <View style={styles.pickedTextCol}>
              <Text style={styles.pickedLabel}>To</Text>
              <Text style={styles.pickedName} numberOfLines={1}>
                {contactDisplayName(picked)}
              </Text>
              <Text style={styles.pickedTarget} numberOfLines={1}>
                {midEllipsis(recipientRaw, 14, 8)}
              </Text>
            </View>
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
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <ContactPickList
            contacts={filtered}
            onPick={onPick}
            isMuted={(c) => !nostrShareTarget(c)}
            emptyLabel={
              candidates.length === 0
                ? "No other contacts yet"
                : query.trim()
                  ? "No matches"
                  : "No contacts"
            }
          />
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: footerPad }]}>
          <Pressable
            style={[sheetUi.primaryBtn, { marginTop: 0 }, !canSend && { opacity: 0.5 }]}
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
      </View>
    </InteractiveBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 52,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 15,
    marginBottom: 12,
    textAlignVertical: "center",
    includeFontPadding: false,
  },
  scroll: {
    flex: 1,
    minHeight: 120,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  footer: {
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pickedBanner: {
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pickedTextCol: {
    flex: 1,
    minWidth: 0,
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
    fontSize: 13,
    color: colors.hint,
  },
});
