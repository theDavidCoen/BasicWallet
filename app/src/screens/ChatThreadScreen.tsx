/**
 * Pay in Chat thread (Penpot 15 / 15e / 15f).
 * Encrypted text + request/payment cards; resume-sync via gift-wrap demux.
 */

import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { ChatPaymentCard } from "../components/chat/ChatPaymentCard";
import { ChatRequestCard } from "../components/chat/ChatRequestCard";
import { ChatTextBubble } from "../components/chat/ChatTextBubble";
import {
  chatGateMessage,
  declinePayRequest,
  flushChatOutbox,
  sendChatText,
} from "../chat/chatActions";
import {
  clearThreadUnread,
  ensureChatThread,
  listChatMessages,
  subscribeChatStore,
} from "../chat/chatStore";
import type { ChatMessage } from "../chat/types";
import { contactArkAddress, contactHasNostrId } from "../chat/contactPeer";
import { getContact } from "../contacts/contactStore";
import { contactDisplayName, contactInitials } from "../contacts/types";
import { catchUpGiftWraps } from "../contacts/contactShareWatch";
import { hasNostrIdentity } from "../nostr/identityStore";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

function formatTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ChatThreadScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ChatThread">>();
  const contactId = route.params.contactId;
  const contact = useMemo(() => getContact(contactId), [contactId]);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [hasIdentity, setHasIdentity] = useState(true);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const name = contact ? contactDisplayName(contact) : "Unknown";
  const initials = contact ? contactInitials(contact) : "?";
  const canNostr = contact ? contactHasNostrId(contact) : false;
  const canSendMoney = contact
    ? !!contactArkAddress(contact) ||
      messages.some((m) => m.kind === "request" && !!m.payToJson)
    : false;

  const reload = useCallback(() => {
    ensureChatThread(contactId);
    setMessages(listChatMessages(contactId));
    clearThreadUnread(contactId);
  }, [contactId]);

  useEffect(() => {
    reload();
    return subscribeChatStore(reload);
  }, [reload]);

  useEffect(() => {
    void hasNostrIdentity().then(setHasIdentity);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
      void catchUpGiftWraps({ force: true });
      void flushChatOutbox();
    }, [reload]),
  );

  useEffect(() => {
    if (!messages.length) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  async function onSendText() {
    const body = draft.trim();
    if (!body || sending) return;
    if (!hasIdentity) {
      Alert.alert("Nostr identity", "Create a Nostr identity to send encrypted messages.", [
        { text: "Cancel", style: "cancel" },
        { text: "Create", onPress: () => navigation.navigate("NostrIdentity") },
      ]);
      return;
    }
    const gate = chatGateMessage(contactId);
    if (gate) {
      Alert.alert("Chat unavailable", gate);
      return;
    }
    setSending(true);
    setDraft("");
    try {
      await sendChatText(contactId, body);
    } catch (e) {
      Alert.alert("Send failed", e instanceof Error ? e.message : "Unknown error");
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  function openRequest() {
    if (!hasIdentity) {
      Alert.alert("Nostr identity", "Create a Nostr identity to request payment.", [
        { text: "Cancel", style: "cancel" },
        { text: "Create", onPress: () => navigation.navigate("NostrIdentity") },
      ]);
      return;
    }
    const gate = chatGateMessage(contactId);
    if (gate) {
      Alert.alert("Request unavailable", gate);
      return;
    }
    navigation.navigate("ChatAmount", { contactId, mode: "request" });
  }

  function openSend() {
    if (!canSendMoney && !contactArkAddress(contact!)) {
      Alert.alert(
        "No ark address",
        "Add an ark… address for this contact, or wait for them to include one on a request.",
      );
      return;
    }
    navigation.navigate("ChatAmount", { contactId, mode: "send" });
  }

  async function onDecline(requestId: string) {
    setActionBusy(requestId);
    try {
      await declinePayRequest({ contactId, requestId });
    } catch (e) {
      Alert.alert("Decline failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setActionBusy(null);
    }
  }

  function onPayRequest(msg: ChatMessage) {
    if (!msg.requestId || !msg.amountSats) return;
    navigation.navigate("ChatAmount", {
      contactId,
      mode: "pay",
      requestId: msg.requestId,
      amountSats: msg.amountSats,
      memo: msg.memo ?? undefined,
    });
  }

  if (!contact) {
    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={ui.title}>CHAT</Text>
        <Text style={ui.caption}>Contact not found.</Text>
        <Pressable
          style={ui.secondaryBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={ui.secondaryBtnText}>Back</Text>
        </Pressable>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.headerMeta}>
            <Text style={styles.headerName} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.headerSub}>
              {canNostr ? "Private · encrypted" : "Add npub for encrypted chat"}
            </Text>
          </View>
          <Pressable
            onPress={() => navigation.navigate("ContactEdit", { contactId })}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${name}`}
          >
            <Text style={styles.editLink}>Edit</Text>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          style={styles.thread}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={[
            styles.threadContent,
            messages.length === 0 && styles.threadEmpty,
          ]}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyBody}>
                Private chat with {name}. Encrypted with your account data. Send or
                request sats anytime.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const outgoing = item.direction === "out";
            const time = formatTime(item.createdAt);
            if (item.kind === "text") {
              return (
                <ChatTextBubble
                  body={item.bodyText ?? ""}
                  outgoing={outgoing}
                  status={item.status}
                  timeLabel={time}
                />
              );
            }
            if (item.kind === "payment" && item.amountSats != null) {
              return (
                <ChatPaymentCard
                  outgoing={outgoing}
                  amountSats={item.amountSats}
                  memo={item.memo}
                  timeLabel={time}
                />
              );
            }
            if (item.kind === "request" && item.amountSats != null) {
              return (
                <ChatRequestCard
                  outgoing={outgoing}
                  amountSats={item.amountSats}
                  memo={item.memo}
                  status={item.status}
                  timeLabel={time}
                  busy={actionBusy === item.requestId}
                  onDecline={() =>
                    item.requestId ? void onDecline(item.requestId) : undefined
                  }
                  onPay={() => onPayRequest(item)}
                />
              );
            }
            if (item.kind === "system") {
              return (
                <Text style={styles.system}>{item.bodyText ?? "Update"}</Text>
              );
            }
            return null;
          }}
        />

        <View style={styles.actionBar}>
          <Pressable
            style={[styles.actionBtn, !canNostr && styles.actionDisabled]}
            onPress={openRequest}
            accessibilityRole="button"
            accessibilityLabel="Request"
          >
            <Text style={styles.actionBtnText}>← Request</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={openSend}
            accessibilityRole="button"
            accessibilityLabel="Send"
          >
            <Text style={[styles.actionBtnText, styles.actionBtnPrimaryText]}>Send →</Text>
          </Pressable>
        </View>

        <View style={styles.composerRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={canNostr ? "Type a message…" : "Add npub to chat…"}
            placeholderTextColor={colors.hint}
            style={styles.composer}
            multiline
            editable={canNostr}
          />
          <Pressable
            style={[
              styles.sendDraft,
              (!draft.trim() || sending || !canNostr) && styles.sendDraftDisabled,
            ]}
            disabled={!draft.trim() || sending || !canNostr}
            onPress={() => void onSendText()}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            {sending ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.sendDraftText}>↑</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
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
  headerMeta: { flex: 1, minWidth: 0 },
  headerName: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
  },
  headerSub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginTop: 2,
  },
  editLink: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  thread: { flex: 1 },
  threadContent: {
    paddingVertical: 8,
    paddingBottom: 16,
  },
  threadEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  emptyTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
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
  system: {
    alignSelf: "center",
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    marginVertical: 8,
    textAlign: "center",
  },
  actionBar: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  actionDisabled: { opacity: 0.45 },
  actionBtnPrimary: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  actionBtnText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  actionBtnPrimaryText: { color: "#000" },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  composer: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    backgroundColor: "#111",
  },
  sendDraft: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDraftDisabled: { opacity: 0.35 },
  sendDraftText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: "#000",
  },
});
