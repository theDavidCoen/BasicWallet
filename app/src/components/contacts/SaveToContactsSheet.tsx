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
import {
  canOfferSaveToContacts,
  detectIdentifierKind,
} from "../../contacts/detectKind";
import type { Contact, IdentifierKind } from "../../contacts/types";
import { IDENTIFIER_KIND_LABELS, IDENTIFIER_KIND_ORDER } from "../../contacts/types";
import { InteractiveBottomSheet } from "../sheet/InteractiveBottomSheet";
import { Button, Caption, ScreenTitle, TextField } from "../ui";
import { colors } from "../../theme/colors";
import { fonts } from "../../theme/typography";
import { sheetUi } from "../../theme/sheetUi";
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
  const reusable = canOfferSaveToContacts(destination);

  function resetAndClose() {
    setMode("new");
    setPickExisting(false);
    onDismiss();
  }

  function saveNew() {
    const value = destination.trim();
    if (!value) return;
    if (!canOfferSaveToContacts(value)) {
      Alert.alert(
        "Not reusable",
        "Lightning invoices (BOLT11) are one-time. Save an LNURL or Lightning Address instead.",
      );
      return;
    }
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
    if (!canOfferSaveToContacts(value)) {
      Alert.alert(
        "Not reusable",
        "Lightning invoices (BOLT11) are one-time. Save an LNURL or Lightning Address instead.",
      );
      return;
    }
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

  if (open && !reusable) {
    return (
      <InteractiveBottomSheet
        open={open}
        onDismiss={resetAndClose}
        visibleFraction={0.4}
        portal
      >
        <View style={styles.body}>
          <ScreenTitle style={sheetUi.title}>SAVE TO CONTACTS</ScreenTitle>
          <Caption style={sheetUi.caption}>
            Lightning invoices (BOLT11) are one-time and cannot be saved. Use an
            LNURL or Lightning Address instead.
          </Caption>
          <Button size="sheet" onPress={resetAndClose}>OK</Button>
        </View>
      </InteractiveBottomSheet>
    );
  }

  return (
    <InteractiveBottomSheet
      open={open}
      onDismiss={resetAndClose}
      visibleFraction={0.72}
      avoidKeyboard
      portal
    >
      <View style={styles.body}>
        <ScreenTitle style={sheetUi.title}>SAVE TO CONTACTS</ScreenTitle>
        <Caption style={sheetUi.caption} numberOfLines={2}>
          {destination.trim()}
        </Caption>

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
            <Text style={sheetUi.label}>name</Text>
            <TextField
              value={name}
              onChangeText={setName}
              placeholder="Alice"
            />
            <Text style={sheetUi.label}>type</Text>
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
                <Text style={sheetUi.label}>custom type label</Text>
                <TextField
                  value={customLabel}
                  onChangeText={setCustomLabel}
                  placeholder="e.g. Telegram"
                />
              </>
            ) : null}
            <Button
              size="sheet"
              disabled={!name.trim() || !!existing}
              onPress={saveNew}
            >
              Save contact
            </Button>
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
    paddingBottom: 12,
  },
  warn: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.danger,
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
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  tabOn: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  tabText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.caption,
  },
  tabTextOn: {
    color: colors.onPrimary,
    fontFamily: fonts.bold,
  },
  scroll: {
    maxHeight: 320,
  },
  kinds: {
    marginBottom: 12,
    flexGrow: 0,
  },
  kindChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 8,
    backgroundColor: "#111",
  },
  kindChipOn: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  kindChipText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.caption,
  },
  kindChipTextOn: {
    color: colors.onPrimary,
    fontFamily: fonts.bold,
  },
  cancel: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
  },
});
