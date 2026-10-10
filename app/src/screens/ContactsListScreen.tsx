/**
 * Settings → Contacts list (Penpot 08 / 08d).
 * From Chat & Pay (`selectForChat`): row tap opens chat thread; long-press → Edit.
 */

import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { startTransition, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { ContactPickList } from "../components/contacts/ContactPickList";
import { filterContacts } from "../contacts/contactSearch";
import { syncContactsDirectoryNow } from "../contacts/contactsNostrSync";
import { isDirectoryContact } from "../chat/contactPeer";
import { listContacts } from "../contacts/contactStore";
import type { Contact } from "../contacts/types";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function ContactsListScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "Contacts">>();
  const { t } = useI18n();
  const selectForChat = route.params?.selectForChat === true;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");

  const reload = useCallback(() => {
    // Hide provisional inbound peers until Add (or forever after Deny).
    setContacts(listContacts().filter(isDirectoryContact));
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
      // Navigate immediately; ChatThread loads messages async after interactions.
      startTransition(() => {
        navigation.navigate("ChatThread", { contactId: c.id });
      });
    },
    [navigation],
  );

  const countLabel = useMemo(() => {
    const n = filtered.length;
    const matched = !!query.trim();
    if (matched) {
      return n === 1
        ? t("contacts.countMatched", { count: n })
        : t("contacts.countMatchedPlural", { count: n });
    }
    return n === 1
      ? t("contacts.count", { count: n })
      : t("contacts.countPlural", { count: n });
  }, [filtered.length, query, t]);

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>
        {selectForChat ? t("contacts.chooseTitle") : t("contacts.title")}
      </Text>
      <Text style={ui.caption}>
        {selectForChat ? t("contacts.captionChoose") : t("contacts.captionPrivate")}
      </Text>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t("contacts.searchPlaceholder")}
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
          emptyLabel={
            query.trim() ? t("contacts.emptyNoMatches") : t("contacts.emptyNone")
          }
        />
        <Text style={styles.count}>{countLabel}</Text>
      </ScrollView>

      <Pressable
        style={styles.add}
        onPress={() => navigation.navigate("ContactEdit", {})}
        accessibilityRole="button"
        accessibilityLabel={t("contacts.addContactA11y")}
      >
        <Text style={styles.addText}>
          {t("contacts.addContact")}
        </Text>
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
