/**
 * Settings → Contacts list (Penpot 08 / 08d).
 * From Chat & Pay (`selectForChat`): row tap opens chat thread; long-press → Edit.
 */

import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { ContactPickList } from "../components/contacts/ContactPickList";
import { filterContacts } from "../contacts/contactSearch";
import { syncContactsDirectoryNow } from "../contacts/contactsNostrSync";
import { listContacts } from "../contacts/contactStore";
import type { Contact } from "../contacts/types";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function ContactsListScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "Contacts">>();
  const selectForChat = route.params?.selectForChat === true;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");

  const reload = useCallback(() => {
    setContacts(listContacts());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
      // Pull Nostr directory when opening the list (fresh install / late nsec import).
      void syncContactsDirectoryNow("contacts-focus").then(() => reload());
    }, [reload]),
  );

  const filtered = useMemo(() => filterContacts(contacts, query), [contacts, query]);

  const openEdit = useCallback(
    (c: Contact) => {
      navigation.navigate("ContactEdit", { contactId: c.id });
    },
    [navigation],
  );

  const openChat = useCallback(
    (c: Contact) => {
      navigation.navigate("ChatThread", { contactId: c.id });
    },
    [navigation],
  );

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>{selectForChat ? "CHOOSE CONTACT" : "CONTACTS"}</Text>
      <Text style={ui.caption}>
        {selectForChat
          ? "Tap to open chat · long-press to edit"
          : "Private · encrypted · no OS contacts"}
      </Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search name or id…"
        placeholderTextColor={colors.hint}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <ContactPickList
          contacts={filtered}
          onPick={selectForChat ? openChat : openEdit}
          onLongPress={selectForChat ? openEdit : undefined}
          emptyLabel={query.trim() ? "No matches" : "No contacts yet"}
        />
        <Text style={styles.count}>
          {filtered.length} contact{filtered.length === 1 ? "" : "s"}
          {query.trim() ? " matched" : ""}
        </Text>
      </ScrollView>

      <Pressable
        style={styles.add}
        onPress={() => navigation.navigate("ContactEdit", {})}
        accessibilityRole="button"
        accessibilityLabel="Add contact"
      >
        <Text style={styles.addText}>+ Add contact</Text>
      </Pressable>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    marginBottom: 14,
    backgroundColor: "#111",
  },
  list: {
    flex: 1,
  },
  count: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginTop: 16,
  },
  add: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  addText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000",
  },
});
