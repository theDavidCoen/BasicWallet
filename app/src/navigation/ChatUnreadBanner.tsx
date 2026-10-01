/**
 * Home dialog: unread Pay in Chat activity (text and/or payment request).
 * Persists via SQLCipher unread_count; clears when the thread is opened.
 * Same visual family as BackupReminderBanner / ContactShareReminder.
 */

import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import type { RootStackParamList } from "./types";
import {
  subscribeChatStore,
  summarizeUnreadChatActivity,
  type UnreadChatSummary,
} from "../chat/chatStore";
import {
  queueContactShareWatchBoot,
} from "../contacts/contactShareWatch";
import { useWallet } from "../wallet/WalletProvider";
import { useSheets } from "./SheetHost";
import { colors } from "../theme/colors";

function emptySummary(): UnreadChatSummary {
  return {
    threadCount: 0,
    totalUnread: 0,
    singleContactId: null,
    hasText: false,
    hasPaymentRequest: false,
  };
}

function bannerCopy(s: UnreadChatSummary): { title: string; body: string } {
  const both = s.hasText && s.hasPaymentRequest;
  if (both) {
    return {
      title: "New chat message · Payment request",
      body: "Tap to open Chat & Pay.",
    };
  }
  if (s.hasPaymentRequest) {
    return {
      title: "Payment request",
      body:
        s.threadCount === 1
          ? "Someone asked you to pay. Tap to open."
          : "You have payment requests. Tap to open Chat & Pay.",
    };
  }
  return {
    title: "New chat message",
    body:
      s.threadCount === 1
        ? "You have an unread private message. Tap to open."
        : "You have unread private messages. Tap to open Chat & Pay.",
  };
}

export function ChatUnreadBanner({
  navigationRef,
}: {
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
}) {
  const insets = useSafeAreaInsets();
  const { hasWallet } = useWallet();
  const {
    activityOpen,
    walletOpen,
    fundsReceivedOpen,
    fundsSentOpen,
    posOpen,
    scanOpen,
    fiatModeSheetOpen,
  } = useSheets();
  const [summary, setSummary] = useState<UnreadChatSummary>(emptySummary);
  const [routeName, setRouteName] = useState<string | undefined>();

  const sheetOpen =
    activityOpen ||
    walletOpen ||
    fundsReceivedOpen ||
    fundsSentOpen ||
    posOpen ||
    scanOpen ||
    fiatModeSheetOpen;

  const refresh = useCallback(() => {
    if (!hasWallet) {
      setSummary(emptySummary());
      return;
    }
    try {
      setSummary(summarizeUnreadChatActivity());
    } catch (e) {
      console.warn("[basic] chat unread summary failed", e);
      setSummary(emptySummary());
    }
  }, [hasWallet]);

  useEffect(() => {
    if (!hasWallet) {
      setSummary(emptySummary());
      return;
    }
    // Gift-wrap demux (contact share + chat) — same boot as ContactShareReminder.
    queueContactShareWatchBoot();
    refresh();
    return subscribeChatStore(refresh);
  }, [hasWallet, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    const syncRoute = () => {
      setRouteName(navigationRef.getCurrentRoute()?.name);
      refresh();
    };
    syncRoute();
    const unsub = navigationRef.addListener("state", syncRoute);
    return unsub;
  }, [navigationRef, refresh]);

  const visible = summary.totalUnread > 0;
  const hidden =
    sheetOpen || !visible || !hasWallet || routeName !== "Home";

  if (hidden) return null;

  const { title, body } = bannerCopy(summary);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
    >
      <Pressable
        style={styles.dialog}
        onPress={() => {
          if (!navigationRef.isReady()) return;
          if (summary.singleContactId) {
            navigationRef.navigate("ChatThread", {
              contactId: summary.singleContactId,
            });
          } else {
            navigationRef.navigate("PayHub");
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 28,
    zIndex: 52,
  },
  dialog: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.fg,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 6,
  },
  body: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 17,
  },
});
