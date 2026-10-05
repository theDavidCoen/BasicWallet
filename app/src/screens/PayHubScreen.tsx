/**
 * Chat & Pay hub (Penpot 15g) — Ask Cursor section above human threads.
 */

import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { startTransition, useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import {
  countArchivedChatThreads,
  getChatThread,
  listChatThreads,
  setChatThreadArchived,
  subscribeChatStore,
} from "../chat/chatStore";
import type { ChatThread } from "../chat/types";
import { getContact, listContacts } from "../contacts/contactStore";
import { contactDisplayName, contactInitials } from "../contacts/types";
import type { Contact } from "../contacts/types";
import { CURSOR_BOT_CONTACT_ID } from "../agent/botConstants";
import {
  getCursorBotContact,
  isCursorBotContact,
} from "../agent/botContact";
import { AdaptiveText, suggestionChipsFor, useI18n } from "../i18n";
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

type Row = { thread: ChatThread; contact: Contact };

function ThreadRow({
  row,
  onOpen,
  onLongPress,
}: {
  row: Row;
  onOpen: () => void;
  onLongPress?: () => void;
}) {
  const { t } = useI18n();
  const name = contactDisplayName(row.contact);
  return (
    <Pressable
      style={styles.row}
      onPress={onOpen}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={t("chat.openChatWith", { name })}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{contactInitials(row.contact)}</Text>
      </View>
      <View style={styles.rowMeta}>
        <Text style={styles.rowName} numberOfLines={1}>
          {name}
        </Text>
        <AdaptiveText style={styles.rowSub} baseFontSize={12} numberOfLines={1}>
          {row.thread.unreadCount > 0
            ? t("chat.unread", { count: row.thread.unreadCount })
            : row.thread.archived
              ? t("chat.archivedLongPress")
              : t("chat.privateChat")}
        </AdaptiveText>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.rowDate}>{formatDay(row.thread.lastMessageAt)}</Text>
        {row.thread.unreadCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {row.thread.unreadCount > 9 ? "9+" : String(row.thread.unreadCount)}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function PayHubScreen() {
  const navigation = useNavigation<RootNav>();
  const { t, locale } = useI18n();
  const suggestionChips = suggestionChipsFor(locale);
  const [threads, setThreads] = useState<ChatThread[]>(() =>
    listChatThreads({ archived: false }),
  );
  const [archivedThreads, setArchivedThreads] = useState<ChatThread[]>(() =>
    listChatThreads({ archived: true }),
  );
  const [archivedCount, setArchivedCount] = useState(() => countArchivedChatThreads());
  const [showArchived, setShowArchived] = useState(false);
  const [contactCount, setContactCount] = useState(() => listContacts().length);
  const [botContact, setBotContact] = useState<Contact | null>(() => getCursorBotContact());

  const reload = useCallback(() => {
    startTransition(() => {
      setThreads(listChatThreads({ archived: false }));
      setArchivedThreads(listChatThreads({ archived: true }));
      setArchivedCount(countArchivedChatThreads());
      setContactCount(listContacts().length);
      setBotContact(getCursorBotContact());
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
      return subscribeChatStore(reload);
    }, [reload]),
  );

  const rows: Row[] = threads
    .map((t) => {
      const c = getContact(t.contactId);
      if (!c || isCursorBotContact(c)) return null;
      return { thread: t, contact: c };
    })
    .filter((r): r is Row => r != null);

  const archivedRows: Row[] = archivedThreads
    .map((t) => {
      const c = getContact(t.contactId);
      if (!c || isCursorBotContact(c)) return null;
      return { thread: t, contact: c };
    })
    .filter((r): r is Row => r != null);

  function openThread(contactId: string) {
    startTransition(() => {
      navigation.navigate("ChatThread", { contactId });
    });
  }

  function openBotWithChip(chip: string) {
    startTransition(() => {
      navigation.navigate("ChatThread", {
        contactId: CURSOR_BOT_CONTACT_ID,
        seedDraft: chip,
      });
    });
  }

  const botThread = botContact ? getChatThread(CURSOR_BOT_CONTACT_ID) : null;
  const botUnread = botThread?.unreadCount ?? 0;

  const askTitle = t("chat.askCursor");
  const aiCaption = t("chat.aiConcierge");

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>{t("chat.hubTitle")}</Text>
      <Text style={ui.caption}>{t("chat.hubCaption")}</Text>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {botContact ? (
          <View style={styles.botSection}>
            <Pressable
              style={styles.botRow}
              onPress={() => openThread(CURSOR_BOT_CONTACT_ID)}
              accessibilityRole="button"
              accessibilityLabel={`${askTitle}. ${aiCaption}`}
            >
              <View style={styles.botAvatar}>
                <Text style={styles.botAvatarText}>AI</Text>
              </View>
              <View style={styles.rowMeta}>
                <AdaptiveText style={styles.botTitle} baseFontSize={15}>
                  {askTitle}
                </AdaptiveText>
                <AdaptiveText style={styles.botCaption} baseFontSize={12}>
                  {aiCaption}
                  {botUnread > 0 ? t("chat.unreadDot", { count: botUnread }) : ""}
                </AdaptiveText>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowDate}>
                  {formatDay(botThread?.lastMessageAt ?? null)}
                </Text>
                {botUnread > 0 ? (
                  <View style={styles.botBadge}>
                    <Text style={styles.badgeText}>
                      {botUnread > 9 ? "9+" : String(botUnread)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {suggestionChips.map((chip) => (
                <Pressable
                  key={chip}
                  style={styles.chip}
                  onPress={() => openBotWithChip(chip)}
                  accessibilityRole="button"
                  accessibilityLabel={chip}
                >
                  <Text style={styles.chipText} numberOfLines={2}>
                    {chip}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {rows.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              {botContact ? t("chat.noContactChatsYet") : t("chat.noChatsYet")}
            </Text>
            <Text style={styles.emptyBody}>
              {botContact ? t("chat.emptyWithBot") : t("chat.emptyWithoutBot")}
            </Text>
          </View>
        ) : (
          rows.map((row) => (
            <ThreadRow
              key={row.thread.contactId}
              row={row}
              onOpen={() => openThread(row.thread.contactId)}
              onLongPress={() => {
                setChatThreadArchived(row.thread.contactId, true);
              }}
            />
          ))
        )}

        {archivedCount > 0 ? (
          <Pressable
            style={styles.archivedToggle}
            onPress={() => setShowArchived((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={
              showArchived ? t("chat.hideArchived") : t("chat.showArchived")
            }
          >
            <AdaptiveText style={styles.archivedToggleText} baseFontSize={13}>
              {showArchived ? "▾" : "▸"}{" "}
              {t("chat.archivedToggle", { count: archivedCount })}
            </AdaptiveText>
          </Pressable>
        ) : null}

        {showArchived
          ? archivedRows.map((row) => (
              <ThreadRow
                key={`a-${row.thread.contactId}`}
                row={row}
                onOpen={() => openThread(row.thread.contactId)}
                onLongPress={() => {
                  setChatThreadArchived(row.thread.contactId, false);
                }}
              />
            ))
          : null}

        {contactCount > 0 && rows.length === 0 ? (
          <Text style={styles.hint}>
            {contactCount === 1
              ? t("chat.contactsAvailable", { count: contactCount })
              : t("chat.contactsAvailablePlural", { count: contactCount })}
          </Text>
        ) : null}
      </ScrollView>

      <Pressable
        style={ui.secondaryBtn}
        onPress={() => navigation.navigate("Contacts", { selectForChat: true })}
        accessibilityRole="button"
        accessibilityLabel={t("chat.openContacts")}
      >
        <AdaptiveText style={ui.secondaryBtnText} baseFontSize={15}>
          {t("chat.openContacts")}
        </AdaptiveText>
      </Pressable>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, marginTop: 16 },
  listContent: { paddingBottom: 16 },
  botSection: {
    marginBottom: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  botRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  botAvatar: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.fg,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  botAvatarText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
  },
  botTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: colors.fg,
  },
  botCaption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    marginTop: 2,
  },
  botBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  chipRow: {
    gap: 8,
    paddingTop: 10,
    paddingRight: 8,
  },
  chip: {
    maxWidth: 220,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.card,
  },
  chipText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
    lineHeight: 16,
  },
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
  archivedToggle: {
    marginTop: 18,
    marginBottom: 4,
    paddingVertical: 8,
  },
  archivedToggleText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.caption,
  },
  hint: {
    marginTop: 16,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
  },
});
