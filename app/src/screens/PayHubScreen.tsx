/**
 * Chat & Pay hub (Penpot 15g) — recent threads + open contacts.
 */

import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import {
  listChatThreads,
  subscribeChatStore,
} from "../chat/chatStore";
import type { ChatThread } from "../chat/types";
import { getContact, listContacts } from "../contacts/contactStore";
import { contactDisplayName, contactInitials } from "../contacts/types";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

function formatDay(ms: number | null): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function PayHubScreen() {
  const navigation = useNavigation<RootNav>();
  const [threads, setThreads] = useState<ChatThread[]>(() => listChatThreads());
  const contacts = useMemo(() => listContacts(), [threads]);

  const reload = useCallback(() => {
    setThreads(listChatThreads());
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
      return subscribeChatStore(reload);
    }, [reload]),
  );

  const rows = threads
    .map((t) => {
      const c = getContact(t.contactId);
      if (!c) return null;
      return { thread: t, contact: c };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>CHAT & PAY</Text>
      <Text style={ui.caption}>
        Private chats with contacts. Encrypted with your account data.
      </Text>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No chats yet</Text>
            <Text style={styles.emptyBody}>
              Open a contact to start a private payment chat. Text, requests, and
              payments live in one thread.
            </Text>
          </View>
        ) : (
          rows.map(({ thread, contact }) => {
            const name = contactDisplayName(contact);
            return (
              <Pressable
                key={thread.contactId}
                style={styles.row}
                onPress={() =>
                  navigation.navigate("ChatThread", { contactId: thread.contactId })
                }
                accessibilityRole="button"
                accessibilityLabel={`Open chat with ${name}`}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{contactInitials(contact)}</Text>
                </View>
                <View style={styles.rowMeta}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {thread.unreadCount > 0
                      ? `${thread.unreadCount} unread`
                      : "Private chat"}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.rowDate}>{formatDay(thread.lastMessageAt)}</Text>
                  {thread.unreadCount > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {thread.unreadCount > 9 ? "9+" : String(thread.unreadCount)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}

        {contacts.length > 0 && rows.length === 0 ? (
          <Text style={styles.hint}>
            {contacts.length} contact{contacts.length === 1 ? "" : "s"} available
          </Text>
        ) : null}
      </ScrollView>

      <Pressable
        style={ui.secondaryBtn}
        onPress={() => navigation.navigate("Contacts", { selectForChat: true })}
        accessibilityRole="button"
        accessibilityLabel="Open contacts"
      >
        <Text style={ui.secondaryBtnText}>Open contacts</Text>
      </Pressable>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, marginTop: 16 },
  listContent: { paddingBottom: 16 },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginBottom: 12,
  },
  emptyTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 10,
  },
  emptyBody: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
    color: colors.fg,
  },
  rowMeta: { flex: 1, minWidth: 0 },
  rowName: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  rowSub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginTop: 2,
  },
  rowRight: { alignItems: "flex-end", gap: 6 },
  rowDate: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 11,
    color: "#000",
  },
  hint: {
    marginTop: 16,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
  },
});
