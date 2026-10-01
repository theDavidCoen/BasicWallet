/**
 * Pay in Chat thread (Penpot 15 / 15f). MVP stub: empty thread + Request · Send + composer.
 * Real gift-wrap text / payment cards come in a later phase.
 */

import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { getContact } from "../contacts/contactStore";
import { contactDisplayName, contactInitials } from "../contacts/types";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function ChatThreadScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ChatThread">>();
  const contactId = route.params.contactId;
  const contact = useMemo(() => getContact(contactId), [contactId]);
  const [draft, setDraft] = useState("");

  const name = contact ? contactDisplayName(contact) : "Unknown";
  const initials = contact ? contactInitials(contact) : "?";

  const stubSoon = (label: string) => {
    Alert.alert(label, "Coming in a later Pay in Chat build.");
  };

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
            <Text style={styles.headerSub}>Private · encrypted</Text>
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

        <ScrollView
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyBody}>
              Private chat with {name}. Encrypted with your account data. Send or
              request sats anytime.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.actionBar}>
          <Pressable
            style={styles.actionBtn}
            onPress={() => stubSoon("Request")}
            accessibilityRole="button"
            accessibilityLabel="Request"
          >
            <Text style={styles.actionBtnText}>← Request</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={() => stubSoon("Send")}
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
            placeholder="Type a message…"
            placeholderTextColor={colors.hint}
            style={styles.composer}
            multiline
            editable
          />
          <Pressable
            style={[styles.sendDraft, !draft.trim() && styles.sendDraftDisabled]}
            disabled={!draft.trim()}
            onPress={() => {
              stubSoon("Message");
              setDraft("");
            }}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Text style={styles.sendDraftText}>↑</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
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
  headerMeta: {
    flex: 1,
    minWidth: 0,
  },
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
  thread: {
    flex: 1,
  },
  threadContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingVertical: 24,
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
  actionBtnPrimary: {
    backgroundColor: colors.fg,
    borderColor: colors.fg,
  },
  actionBtnText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
  actionBtnPrimaryText: {
    color: "#000",
  },
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
  sendDraftDisabled: {
    opacity: 0.35,
  },
  sendDraftText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 18,
    color: "#000",
  },
});
