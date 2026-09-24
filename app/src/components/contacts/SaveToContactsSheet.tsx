/**
 * Save destination to contacts (new or add identifier to existing).
 */

import { useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  createContactDraft,
  createEmptyIdentifier,
  findContactByIdentifierValue,
  getContact,
  listContacts,
  upsertContact,
} from "../../contacts/contactStore";
import { detectIdentifierKind } from "../../contacts/detectKind";
import type { Contact, IdentifierKind } from "../../contacts/types";
import { IDENTIFIER_KIND_LABELS, IDENTIFIER_KIND_ORDER } from "../../contacts/types";
import { InteractiveBottomSheet } from "../sheet/InteractiveBottomSheet";
import { colors } from "../../theme/colors";
import { ContactPickList } from "./ContactPickList";

export function SaveToContactsSheet({
  open,
  onDismiss,
  destination,
  suggestedName,
}: {
  open: boolean;
  onDismiss: () => void;
  destination: string;
  suggestedName?: string;
}) {
  const existing = useMemo(
    () => (destination.trim() ? findContactByIdentifierValue(destination) : null),
    [destination],
  );
  const [name, setName] = useState(suggestedName?.trim() || "");
  const [kind, setKind] = useState<IdentifierKind>(() => detectIdentifierKind(destination));
  const [customLabel, setCustomLabel] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [pickExisting, setPickExisting] = useState(false);
  const contacts = useMemo(() => listContacts(), [open]);

  function resetAndClose() {
    setMode("new");
    setPickExisting(false);
    onDismiss();
  }

  function saveNew() {
    const value = destination.trim();
    if (!value) return;
    if (!name.trim()) {
      Alert.alert("Name required", "Enter a name for this contact.");
      return;
    }
    if (kind === "custom" && !customLabel.trim()) {
      Alert.alert("Custom type", "Enter a label for the custom type.");
      return;
    }
    if (existing) {
      Alert.alert("Already saved", `This identifier is already on “${existing.name}”.`);
      return;
    }
    const draft = createContactDraft({ name: name.trim(), kind, value });
    if (kind === "custom") {
      draft.identifiers[0]!.customKindLabel = customLabel.trim();
    }
    upsertContact(draft);
    Alert.alert("Saved", `${name.trim()} added to contacts.`);
    resetAndClose();
  }

  function addToExisting(contact: Contact) {
    const value = destination.trim();
    if (!value) return;
    if (contact.identifiers.some((i) => i.value.trim().toLowerCase() === value.toLowerCase())) {
      Alert.alert("Already on contact", `“${contact.name}” already has this identifier.`);
      return;
    }
    const ident = createEmptyIdentifier(kind, value);
    if (kind === "custom") ident.customKindLabel = customLabel.trim() || "custom";
    const latest = getContact(contact.id) ?? contact;
    upsertContact({
      ...latest,
      identifiers: [...latest.identifiers, ident],
    });
    Alert.alert("Saved", `Added to “${contact.name}”.`);
    resetAndClose();
  }

  return (
    <InteractiveBottomSheet open={open} onDismiss={resetAndClose} visibleFraction={0.72}>
      <View style={styles.body}>
        <Text style={styles.title}>SAVE TO CONTACTS</Text>
        <Text style={styles.caption} numberOfLines={2}>
          {destination.trim()}
        </Text>

        {existing ? (
          <Text style={styles.warn}>Already saved as {existing.name}</Text>
        ) : null}

        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, mode === "new" && styles.tabOn]}
            onPress={() => {
              setMode("new");
              setPickExisting(false);
            }}
          >
            <Text style={[styles.tabText, mode === "new" && styles.tabTextOn]}>New</Text>
          </Pressable>
          <Pressable
            style={[styles.tab, mode === "existing" && styles.tabOn]}
            onPress={() => {
              setMode("existing");
              setPickExisting(true);
            }}
          >
            <Text style={[styles.tabText, mode === "existing" && styles.tabTextOn]}>
              Add to existing
            </Text>
          </Pressable>
        </View>

        {mode === "new" ? (
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            <Text style={styles.label}>name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Alice"
              placeholderTextColor={colors.hint}
              style={styles.input}
            />
            <Text style={styles.label}>type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.kinds}>
              {IDENTIFIER_KIND_ORDER.map((k) => (
                <Pressable
                  key={k}
                  style={[styles.kindChip, kind === k && styles.kindChipOn]}
                  onPress={() => setKind(k)}
                >
                  <Text style={[styles.kindChipText, kind === k && styles.kindChipTextOn]}>
                    {IDENTIFIER_KIND_LABELS[k]}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {kind === "custom" ? (
              <>
                <Text style={styles.label}>custom type label</Text>
                <TextInput
                  value={customLabel}
                  onChangeText={setCustomLabel}
                  placeholder="e.g. Telegram"
                  placeholderTextColor={colors.hint}
                  style={styles.input}
                />
              </>
            ) : null}
            <Pressable
              style={[styles.primary, (!name.trim() || !!existing) && { opacity: 0.5 }]}
              disabled={!name.trim() || !!existing}
              onPress={saveNew}
            >
              <Text style={styles.primaryText}>Save contact</Text>
            </Pressable>
          </ScrollView>
        ) : (
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            {pickExisting ? (
              <ContactPickList
                contacts={contacts}
                onPick={addToExisting}
                emptyLabel="No contacts to add to"
              />
            ) : null}
          </ScrollView>
        )}

        <Pressable onPress={resetAndClose} hitSlop={8} style={{ marginTop: 12 }}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
      </View>
    </InteractiveBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 6,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    textAlign: "center",
    marginBottom: 12,
  },
  warn: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: "#E07070",
    textAlign: "center",
    marginBottom: 8,
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  tabOn: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  tabText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  tabTextOn: {
    color: "#000",
    fontFamily: "JetBrainsMono_700Bold",
  },
  scroll: {
    maxHeight: 320,
  },
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    marginBottom: 12,
  },
  kinds: {
    marginBottom: 12,
    flexGrow: 0,
  },
  kindChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginRight: 8,
    backgroundColor: "#111",
  },
  kindChipOn: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  kindChipText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
  },
  kindChipTextOn: {
    color: "#000",
    fontFamily: "JetBrainsMono_700Bold",
  },
  primary: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000",
  },
  cancel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
  },
});
