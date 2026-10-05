/**
 * Pay in Chat thread (Penpot 15 / 15e / 15f).
 * Encrypted text + request/payment cards; resume-sync via gift-wrap demux.
 */

import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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
  failStaleOutboundPayments,
  getChatMessage,
  getChatThread,
  insertChatMessage,
  listChatMessages,
  setChatThreadArchived,
  subscribeChatStore,
  updateChatMessage,
} from "../chat/chatStore";
import { reconcileOutboundChatPayments } from "../chat/reconcileOutboundChat";
import { setChatThreadFocused } from "../chat/chatThreadFocus";
import type { ChatMessage } from "../chat/types";
import { newChatId } from "../chat/types";
import { contactArkAddress, contactHasNostrId } from "../chat/contactPeer";
import {
  executeChatPay,
  resolveChatPayTarget,
} from "../chat/executeChatPay";
import { executeChatLightningPay } from "../chat/executeChatLightningPay";
import { ensureChatPayWallet } from "../chat/ensureChatPayWallet";
import { ensureSatsForPay } from "../chat/ensureSatsForPay";
import { receivingFiatTitle } from "../chat/chatInboundFiat";
import {
  formatChatAmountView,
  freezeFiatCaptionFromSats,
} from "../chat/formatChatAmount";
import { getContact } from "../contacts/contactStore";
import { contactDisplayName, contactInitials } from "../contacts/types";
import { catchUpGiftWraps } from "../contacts/contactShareWatch";
import { isCursorBotContact } from "../agent/botContact";
import { enqueueBotFulfillAfterPay } from "../agent/botFulfill";
import { catchUpBotWatch } from "../agent/botWatch";
import { getNetworkConfig } from "../config/network";
import { fetchFiatSpot } from "../fiat/depixAssets";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { AdaptiveText, suggestionChipsFor, useI18n } from "../i18n";
import { hasNostrIdentity } from "../nostr/identityStore";
import { requireUserPresence } from "../security/userPresence";
import { useWallet } from "../wallet/WalletProvider";
import type { BasicWallet } from "../wallet/hdWallet";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { DEFAULT_MIN_VTXO_SATS } from "../wallet/arkMultiSend";

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
  const { t, locale } = useI18n();
  const suggestionChips = suggestionChipsFor(locale);
  const { height: windowHeight } = useWindowDimensions();
  const contactId = route.params.contactId;
  const seedDraft = route.params.seedDraft;
  const contact = useMemo(() => getContact(contactId), [contactId]);
  const isBot = isCursorBotContact(contact);
  const {
    wallet,
    selectedWallet,
    balanceSats,
    balance,
    beginOutboundSend,
    endOutboundSend,
    applyLocalSpend,
    rotateReceiveAddress,
    bumpActivity,
    refreshActivity,
  } = useWallet();
  const {
    fiatMode,
    convertDepixToSatsForPay,
    depixDisplay,
    holdAutoInboundForPay,
  } = useFiatMode();
  const network = getNetworkConfig();
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [payBusyLabel, setPayBusyLabel] = useState<string | null>(null);
  const [hasIdentity, setHasIdentity] = useState(true);
  const [archived, setArchived] = useState(false);
  const [spot, setSpot] = useState<number | null>(null);
  /** Android: Y of keyboard top in screen coords; null when closed. */
  const [keyboardTopY, setKeyboardTopY] = useState<number | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const seededRef = useRef(false);

  const name = contact ? contactDisplayName(contact) : "Unknown";
  const initials = contact ? contactInitials(contact) : "?";
  const canNostr = contact ? contactHasNostrId(contact) : false;
  const canSendMoney = contact
    ? !!contactArkAddress(contact) ||
      messages.some((m) => m.kind === "request" && !!m.payToJson)
    : false;

  const reloadLight = useCallback(() => {
    // Clear unread immediately so Home banner/badge update before paint work.
    clearThreadUnread(contactId);
    // Keep first paint cheap: only read messages after the transition starts.
    startTransition(() => {
      ensureChatThread(contactId);
      setMessages(listChatMessages(contactId));
      setArchived(getChatThread(contactId)?.archived === true);
    });
  }, [contactId]);

  useEffect(() => {
    // α69: flip false-Failed / hung Sending → paid when activity proves settle.
    if (selectedWallet?.id) {
      try {
        reconcileOutboundChatPayments({
          networkId: network.id,
          walletId: selectedWallet.id,
        });
      } catch (e) {
        console.warn("[basic] reconcileOutboundChatPayments skipped", e);
      }
    }
    // Ghost Converting/Sending only after send soft-timeout window (4 min).
    failStaleOutboundPayments({ olderThanMs: 4 * 60_000 });
    const task = InteractionManager.runAfterInteractions(() => {
      reloadLight();
    });
    return () => {
      task.cancel();
    };
  }, [reloadLight, selectedWallet?.id, network.id]);

  // α77: while Sending/Converting, poll reconcile so ASP settle flips You sent
  // even when wallet.send hangs (Xiaomi).
  useEffect(() => {
    if (!selectedWallet?.id) return;
    const pending = messages.some(
      (m) =>
        m.kind === "payment" &&
        m.direction === "out" &&
        (m.status === "sending" || m.status === "converting"),
    );
    if (!pending) return;
    const tick = () => {
      if (AppState.currentState !== "active") return;
      try {
        const n = reconcileOutboundChatPayments({
          networkId: network.id,
          walletId: selectedWallet.id,
          republishReceipt: true,
        });
        if (n > 0) {
          setMessages(listChatMessages(contactId));
        }
      } catch (e) {
        console.warn("[basic] chat sending reconcile tick failed", e);
      }
    };
    tick();
    // α82: pause while backgrounded — SQLCipher reconcile is local but still burns JS.
    const t = setInterval(tick, 2_000);
    return () => clearInterval(t);
  }, [messages, selectedWallet?.id, network.id, contactId]);

  useEffect(() => {
    return subscribeChatStore(() => {
      startTransition(() => {
        setMessages(listChatMessages(contactId));
        setArchived(getChatThread(contactId)?.archived === true);
        // Keep unread at 0 while this thread is open (live inbound).
        clearThreadUnread(contactId);
      });
    });
  }, [contactId]);

  useEffect(() => {
    void hasNostrIdentity().then(setHasIdentity);
  }, []);

  useEffect(() => {
    if (seededRef.current) return;
    const seed = typeof seedDraft === "string" ? seedDraft.trim() : "";
    if (!seed) return;
    seededRef.current = true;
    setDraft(seed);
  }, [seedDraft]);

  useEffect(() => {
    if (!fiatMode) {
      setSpot(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const s = await fetchFiatSpot(network.id);
      if (!cancelled) setSpot(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [fiatMode, network.id]);

  useFocusEffect(
    useCallback(() => {
      setChatThreadFocused(true, contactId);
      // Clear unread on focus before deferred catch-up (accurate banner/badge).
      clearThreadUnread(contactId);
      // Defer network catch-up so navigation / first paint stay snappy.
      const task = InteractionManager.runAfterInteractions(() => {
        startTransition(() => {
          ensureChatThread(contactId);
          setMessages(listChatMessages(contactId));
          clearThreadUnread(contactId);
        });
        // α71: Nostr/outbox only — never rematerialize from chat focus (Xiaomi lag).
        void catchUpGiftWraps({ force: true });
        if (isBot) void catchUpBotWatch({ force: true });
        void flushChatOutbox();
        if (selectedWallet?.id) {
          try {
            reconcileOutboundChatPayments({
              networkId: network.id,
              walletId: selectedWallet.id,
            });
          } catch (e) {
            console.warn("[basic] chat focus reconcile failed", e);
          }
        }
      });
      return () => {
        setChatThreadFocused(false);
        task.cancel();
      };
    }, [contactId, selectedWallet?.id, network.id, isBot]),
  );

  useEffect(() => {
    if (!messages.length) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [messages.length]);

  // Android edge-to-edge (`edgeToEdgeEnabled=true`) + transparent nav bar:
  // windowSoftInputMode=adjustResize does not shrink the RN root, and
  // KeyboardAvoidingView with behavior=undefined leaves the composer under
  // Gboard. Use keyboard *top* (screenY), not height alone — Xiaomi/Gboard
  // height is under-reported vs the real IME inset.
  useEffect(() => {
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e) => {
      const screenY = e.endCoordinates?.screenY;
      const height = e.endCoordinates?.height ?? 0;
      if (typeof screenY === "number" && screenY > 0) {
        setKeyboardTopY(screenY);
      } else if (height > 0) {
        setKeyboardTopY(Math.max(0, windowHeight - height));
      } else {
        setKeyboardTopY(null);
      }
    });
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardTopY(null));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [windowHeight]);

  useEffect(() => {
    if (keyboardTopY == null) return;
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 50);
    return () => clearTimeout(t);
  }, [keyboardTopY]);

  // Composer sits above ScreenChrome bottom pad. Do NOT subtract that pad from
  // the lift: on Xiaomi/Gboard, Keyboard screenY is the key-area top (below the
  // suggestion strip), so subtracting chrome pad leaves the field under the
  // predictions bar. Full windowHeight - screenY clears the real IME inset.
  const androidComposerLift =
    Platform.OS === "android" && keyboardTopY != null
      ? Math.max(0, windowHeight - keyboardTopY)
      : 0;

  async function onSendText() {
    const body = draft.trim();
    if (!body || sending) return;
    if (!hasIdentity) {
      Alert.alert(t("chat.alertNostrTitle"), t("chat.alertNostrSend"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.continue"), onPress: () => navigation.navigate("NostrIdentity") },
      ]);
      return;
    }
    const gate = chatGateMessage(contactId);
    if (gate) {
      Alert.alert(t("chat.alertChatUnavailable"), gate);
      return;
    }
    setSending(true);
    setDraft("");
    try {
      await sendChatText(contactId, body);
    } catch (e) {
      Alert.alert(
        t("chat.alertSendFailed"),
        e instanceof Error ? e.message : t("common.unknownError"),
      );
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  function openRequest() {
    if (!hasIdentity) {
      Alert.alert(t("chat.alertNostrTitle"), t("chat.alertNostrRequest"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("common.continue"), onPress: () => navigation.navigate("NostrIdentity") },
      ]);
      return;
    }
    const gate = chatGateMessage(contactId);
    if (gate) {
      Alert.alert(t("chat.alertRequestUnavailable"), gate);
      return;
    }
    navigation.navigate("ChatAmount", { contactId, mode: "request" });
  }

  function openSend() {
    if (!canSendMoney && !contactArkAddress(contact!)) {
      Alert.alert(t("chat.alertNoArkTitle"), t("chat.alertNoArkBody"));
      return;
    }
    navigation.navigate("ChatAmount", { contactId, mode: "send" });
  }

  async function onDecline(requestId: string) {
    setActionBusy(requestId);
    try {
      await declinePayRequest({ contactId, requestId });
    } catch (e) {
      Alert.alert(
        t("chat.alertDeclineFailed"),
        e instanceof Error ? e.message : t("common.unknownError"),
      );
    } finally {
      setActionBusy(null);
    }
  }

  async function onPayRequest(msg: ChatMessage) {
    if (!msg.requestId || !msg.amountSats || actionBusy) return;

    // Prefer currently selected Arkade wallet (Personal), even when React
    // `wallet` is still null and Home is only showing a cached balance.
    const payWallet = await ensureChatPayWallet({ wallet, selectedWallet });
    if (!payWallet.ok) {
      Alert.alert(t("chat.alertWallet"), payWallet.message);
      return;
    }

    let target: ReturnType<typeof resolveChatPayTarget>;
    try {
      target = resolveChatPayTarget({
        contactId,
        requestId: msg.requestId,
      });
    } catch (e) {
      Alert.alert(
        t("chat.alertCannotPayTitle"),
        e instanceof Error ? e.message : t("chat.alertCannotPayBody"),
      );
      return;
    }

    const spendable = balance?.available ?? balanceSats;
    const need = msg.amountSats;
    const dustTarget = fiatMode ? need + DEFAULT_MIN_VTXO_SATS : need;
    const have = spendable ?? 0;
    const needConvert =
      target.kind === "ark" &&
      fiatMode &&
      have < dustTarget &&
      (depixDisplay ?? 0) > 0;

    // Biometrics first (same Confirm+bio UX as chat Send), then balance /
    // convert checks — so Pay always reaches Confirm when a wallet is selected.
    if (target.kind === "bolt11") {
      await runPayRequestLightning(msg, target.invoice, payWallet, {
        spendable,
        need,
        have,
      });
      return;
    }
    await runPayRequest(msg, needConvert, payWallet, {
      spendable,
      need,
      have,
    });
  }

  async function runPayRequestLightning(
    msg: ChatMessage,
    bolt11: string,
    payWallet: { wallet: BasicWallet; walletId: string },
    bal: { spendable: number | null; need: number; have: number },
  ) {
    if (!msg.requestId || !msg.amountSats) return;

    setActionBusy(msg.requestId);
    setPayBusyLabel(t("chat.sending"));
    let localPaymentId: string | null = null;
    try {
      const auth = await requireUserPresence(t("send.confirmSend"));
      if (!auth.ok) {
        Alert.alert(
          t("chat.alertAuthRequired"),
          auth.reason || t("chat.alertAuthBody"),
        );
        return;
      }

      if (bal.spendable != null && bal.need > bal.have) {
        Alert.alert(
          t("chat.alertInsufficientTitle"),
          t("chat.alertInsufficientSats"),
        );
        return;
      }

      let fiatCaption: string | null = null;
      if (fiatMode) {
        const s = spot ?? (await fetchFiatSpot(network.id));
        fiatCaption = freezeFiatCaptionFromSats(msg.amountSats, s, network.id);
      }

      const paymentId = newChatId("pay");
      const local = insertChatMessage({
        contactId,
        kind: "payment",
        direction: "out",
        amountSats: msg.amountSats,
        memo: msg.memo ?? null,
        fiatCaption,
        status: "sending",
        paymentId,
        requestId: msg.requestId,
      });
      localPaymentId = local.id;

      await executeChatLightningPay({
        contactId,
        amountSats: msg.amountSats,
        bolt11,
        memo: msg.memo ?? undefined,
        requestId: msg.requestId,
        fiatCaption,
        localMessageId: local.id,
        paymentId,
        hooks: {
          wallet: payWallet.wallet,
          walletId: payWallet.walletId,
          networkId: network.id,
          beginOutboundSend,
          endOutboundSend,
          applyLocalSpend,
          bumpActivity,
          refreshActivity,
        },
      });
      if (isBot) {
        enqueueBotFulfillAfterPay({
          contactId,
          requestId: msg.requestId,
        });
      }
    } catch (e) {
      if (localPaymentId) {
        const cur = getChatMessage(localPaymentId);
        if (cur?.status === "paid") {
          console.warn("[basic] chat ln pay recovered as paid after error");
        } else {
          updateChatMessage(localPaymentId, { status: "failed" });
          const again = getChatMessage(localPaymentId);
          if (again?.status !== "paid") {
            Alert.alert(
              t("chat.alertSendFailed"),
              e instanceof Error ? e.message : t("common.unknownError"),
            );
          }
        }
      } else {
        Alert.alert(
          t("chat.alertSendFailed"),
          e instanceof Error ? e.message : t("common.unknownError"),
        );
      }
    } finally {
      setActionBusy(null);
      setPayBusyLabel(null);
    }
  }

  async function runPayRequest(
    msg: ChatMessage,
    willConvert: boolean,
    payWallet: { wallet: BasicWallet; walletId: string },
    bal: { spendable: number | null; need: number; have: number },
  ) {
    if (!msg.requestId || !msg.amountSats) return;

    const spendable = bal.spendable;
    setActionBusy(msg.requestId);
    setPayBusyLabel(willConvert ? t("chat.converting") : t("chat.sending"));
    let localPaymentId: string | null = null;
    beginOutboundSend();
    try {
      // Biometrics before any convert (no global CONVERTING dialog for chat).
      const auth = await requireUserPresence(t("send.confirmSend"));
      if (!auth.ok) {
        Alert.alert(
          t("chat.alertAuthRequired"),
          auth.reason || t("chat.alertAuthBody"),
        );
        return;
      }

      if (willConvert && !(depixDisplay != null && depixDisplay > 0)) {
        Alert.alert(
          t("chat.alertInsufficientTitle"),
          t("chat.alertInsufficientFiat"),
        );
        return;
      }
      if (!willConvert && bal.spendable != null && bal.need > bal.have) {
        Alert.alert(
          t("chat.alertInsufficientTitle"),
          t("chat.alertInsufficientSats"),
        );
        return;
      }

      let fiatCaption: string | null = null;
      if (fiatMode) {
        const s = spot ?? (await fetchFiatSpot(network.id));
        fiatCaption = freezeFiatCaptionFromSats(msg.amountSats, s, network.id);
      }

      const paymentId = newChatId("pay");
      const local = insertChatMessage({
        contactId,
        kind: "payment",
        direction: "out",
        amountSats: msg.amountSats,
        memo: msg.memo ?? null,
        fiatCaption,
        status: willConvert ? "converting" : "sending",
        paymentId,
        requestId: msg.requestId,
      });
      localPaymentId = local.id;

      holdAutoInboundForPay(180_000);
      const ensured = await ensureSatsForPay({
        satsNeeded: msg.amountSats,
        spendable: spendable ?? null,
        fiatMode,
        depixDisplay,
        networkId: network.id,
        convertDepixToSatsForPay,
        quiet: true,
        readLiveSpendableSats: async () => {
          try {
            const raw = await payWallet.wallet.getBalance();
            if (
              raw &&
              typeof raw === "object" &&
              typeof (raw as { available?: unknown }).available === "number"
            ) {
              return Math.floor((raw as { available: number }).available);
            }
          } catch {
            /* ignore */
          }
          return null;
        },
      });
      holdAutoInboundForPay(180_000);
      setPayBusyLabel(t("chat.sending"));
      updateChatMessage(local.id, { status: "sending" });

      await executeChatPay({
        contactId,
        amountSats: msg.amountSats,
        memo: msg.memo ?? undefined,
        requestId: msg.requestId,
        fiatCaption,
        skipPresence: true,
        localMessageId: local.id,
        paymentId,
        hooks: {
          wallet: payWallet.wallet,
          walletId: payWallet.walletId,
          networkId: network.id,
          spendable: ensured.spendable ?? spendable ?? null,
          beginOutboundSend,
          endOutboundSend,
          applyLocalSpend,
          getFreshArkAddress: async () => rotateReceiveAddress(),
          bumpActivity,
          refreshActivity,
        },
      });
      if (isBot) {
        enqueueBotFulfillAfterPay({
          contactId,
          requestId: msg.requestId,
        });
      }
    } catch (e) {
      if (localPaymentId) {
        const cur = getChatMessage(localPaymentId);
        if (cur?.status === "paid") {
          console.warn("[basic] chat pay request recovered as paid after error");
        } else {
          updateChatMessage(localPaymentId, { status: "failed" });
          const again = getChatMessage(localPaymentId);
          if (again?.status !== "paid") {
            Alert.alert(
              t("chat.alertSendFailed"),
              e instanceof Error ? e.message : t("common.unknownError"),
            );
          }
        }
      } else {
        Alert.alert(
          t("chat.alertSendFailed"),
          e instanceof Error ? e.message : t("common.unknownError"),
        );
      }
    } finally {
      endOutboundSend();
      setActionBusy(null);
      setPayBusyLabel(null);
    }
  }

  function onArchiveToggle() {
    const next = !archived;
    Alert.alert(
      next ? "Archive chat?" : "Unarchive chat?",
      next
        ? `Hide this chat with ${name} from Chat & Pay. History is kept.`
        : `Show this chat with ${name} in Chat & Pay again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: next ? "Archive" : "Unarchive",
          onPress: () => {
            setChatThreadArchived(contactId, next);
            setArchived(next);
            if (next && navigation.canGoBack()) {
              navigation.goBack();
            }
          },
        },
      ],
    );
  }

  if (!contact) {
    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={ui.title}>{t("chat.threadTitle")}</Text>
        <Text style={ui.caption}>{t("chat.contactNotFound")}</Text>
        <Pressable
          style={ui.secondaryBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Text style={ui.secondaryBtnText}>{t("common.back")}</Text>
        </Pressable>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <KeyboardAvoidingView
        style={[
          styles.flex,
          androidComposerLift > 0 && { paddingBottom: androidComposerLift },
        ]}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        <View style={styles.headerRow}>
          <View style={[styles.avatar, isBot && styles.botAvatar]}>
            <Text style={styles.avatarText}>{isBot ? "AI" : initials}</Text>
          </View>
          <View style={styles.headerMeta}>
            <AdaptiveText style={styles.headerName} baseFontSize={16}>
              {isBot ? t("chat.askName", { name }) : name}
            </AdaptiveText>
            <AdaptiveText style={styles.headerSub} baseFontSize={12}>
              {archived
                ? t("chat.archived")
                : isBot
                  ? t("chat.aiConcierge")
                  : canNostr
                    ? t("chat.privateEncrypted")
                    : t("chat.addNpubForChat")}
            </AdaptiveText>
          </View>
          {!isBot ? (
            <>
              <Pressable
                onPress={onArchiveToggle}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={
                  archived
                    ? t("chat.unarchiveA11y", { name })
                    : t("chat.archiveA11y", { name })
                }
              >
                <AdaptiveText style={styles.editLink} baseFontSize={13}>
                  {archived ? t("chat.unarchive") : t("chat.archive")}
                </AdaptiveText>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate("ContactEdit", { contactId })}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("chat.editA11y", { name })}
              >
                <Text style={styles.editLink}>{t("common.edit")}</Text>
              </Pressable>
            </>
          ) : null}
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
              <Text style={styles.emptyTitle}>
                {isBot ? t("chat.askAnything") : t("chat.noMessagesYet")}
              </Text>
              <Text style={styles.emptyBody}>
                {isBot
                  ? t("chat.botEmptyBody")
                  : t("chat.threadEmptyBody", { name })}
              </Text>
              {isBot
                ? suggestionChips.map((chip) => (
                    <Pressable
                      key={chip}
                      style={styles.suggestChip}
                      onPress={() => setDraft(chip)}
                      accessibilityRole="button"
                      accessibilityLabel={chip}
                    >
                      <Text style={styles.suggestChipText}>{chip}</Text>
                    </Pressable>
                  ))
                : null}
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
              const inboundPending =
                !outgoing &&
                (item.status === "arriving" || item.status === "converting");
              const view = formatChatAmountView({
                amountSats: item.amountSats,
                viewerFiatMode: fiatMode,
                networkId: network.id,
                fiatCaption: item.fiatCaption,
                spot,
              });
              return (
                <ChatPaymentCard
                  outgoing={outgoing}
                  amountSats={item.amountSats}
                  memo={item.memo}
                  timeLabel={time}
                  status={item.status}
                  primaryAmount={inboundPending ? null : view.primary}
                  secondaryAmount={inboundPending ? null : view.secondary}
                  receivingLabel={
                    inboundPending ? receivingFiatTitle(network.id) : null
                  }
                  hideAmount={inboundPending}
                />
              );
            }
            if (item.kind === "request" && item.amountSats != null) {
              const view = formatChatAmountView({
                amountSats: item.amountSats,
                viewerFiatMode: fiatMode,
                networkId: network.id,
                fiatCaption: item.fiatCaption,
                spot,
              });
              return (
                <ChatRequestCard
                  outgoing={outgoing}
                  amountSats={item.amountSats}
                  memo={item.memo}
                  status={item.status}
                  timeLabel={time}
                  busy={actionBusy === item.requestId}
                  busyLabel={
                    actionBusy === item.requestId ? payBusyLabel : null
                  }
                  primaryAmount={view.primary}
                  secondaryAmount={view.secondary}
                  onDecline={() =>
                    item.requestId ? void onDecline(item.requestId) : undefined
                  }
                  onPay={() => void onPayRequest(item)}
                />
              );
            }
            if (item.kind === "system") {
              return (
                <Text style={styles.system}>
                  {item.bodyText ?? t("common.update")}
                </Text>
              );
            }
            return null;
          }}
        />

        {!isBot ? (
          <View style={styles.actionBar}>
            <Pressable
              style={[styles.actionBtn, !canNostr && styles.actionDisabled]}
              onPress={openRequest}
              accessibilityRole="button"
              accessibilityLabel={t("chat.requestA11y")}
            >
              <AdaptiveText style={styles.actionBtnText} baseFontSize={14}>
                {t("chat.request")}
              </AdaptiveText>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={openSend}
              accessibilityRole="button"
              accessibilityLabel={t("chat.sendA11y")}
            >
              <AdaptiveText
                style={[styles.actionBtnText, styles.actionBtnPrimaryText]}
                baseFontSize={14}
              >
                {t("chat.send")}
              </AdaptiveText>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.composerRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={
              isBot
                ? t("chat.placeholderBot")
                : canNostr
                  ? t("chat.placeholderMessage")
                  : t("chat.placeholderAddNpub")
            }
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
            accessibilityLabel={t("chat.sendMessageA11y")}
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
  botAvatar: {
    borderRadius: 8,
    borderColor: colors.fg,
    backgroundColor: colors.card,
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
  suggestChip: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.bg,
  },
  suggestChipText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    lineHeight: 17,
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
