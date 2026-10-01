/**
 * Chat amount entry:
 * - Request → POS keypad (ReceivePosPanel chat-request) → publish pay-request
 * - Send → POS keypad (chat-send, Continue) → classic Confirm send → biometrics
 * Pay-from-request never lands here (biometrics-only from the request card).
 */

import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { isValidArkAddress } from "@arkade-os/sdk";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { sendPayRequest } from "../chat/chatActions";
import { contactArkAddress } from "../chat/contactPeer";
import {
  executeChatPay,
  resolveChatPayDestination,
} from "../chat/executeChatPay";
import { getContact } from "../contacts/contactStore";
import { contactDisplayName, midEllipsis } from "../contacts/types";
import { getNetworkConfig } from "../config/network";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { ReceivePosPanel } from "./ReceivePosPanel";

export function ChatAmountScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ChatAmount">>();
  const { contactId, mode } = route.params;
  const contact = useMemo(() => getContact(contactId), [contactId]);
  const { fiatMode } = useFiatMode();
  const {
    wallet,
    selectedWallet,
    balanceSats,
    balance,
    beginOutboundSend,
    endOutboundSend,
    applyLocalSpend,
    arkAddress,
    rotateReceiveAddress,
    bumpActivity,
  } = useWallet();
  const network = getNetworkConfig();

  const [amountSats, setAmountSats] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const name = contact ? contactDisplayName(contact) : "Contact";
  const spendable = balance?.available ?? balanceSats;
  const destArk = contact ? contactArkAddress(contact) : null;

  async function ensurePreferredReceive(): Promise<
    { kind: "ark"; value: string } | undefined
  > {
    let addr = arkAddress?.trim() || null;
    if (!addr || !isValidArkAddress(addr)) {
      try {
        addr = await rotateReceiveAddress();
      } catch {
        addr = null;
      }
    }
    if (addr && isValidArkAddress(addr)) {
      return { kind: "ark", value: addr };
    }
    return undefined;
  }

  const onChatRequestConfirm = useCallback(
    async (sats: number) => {
      if (!contact || busy) return;
      setBusy(true);
      try {
        const preferredReceive = await ensurePreferredReceive();
        if (!preferredReceive) {
          Alert.alert(
            "No receive address",
            "Could not attach your ark address to this request. Check wallet connectivity and try again.",
          );
          return;
        }
        await sendPayRequest({
          contactId,
          amountSats: sats,
          asset: "btc",
          preferredReceive,
        });
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate("ChatThread", { contactId });
        }
      } catch (e) {
        Alert.alert(
          "Request failed",
          e instanceof Error ? e.message : "Unknown error",
        );
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wallet helpers stable enough for one-shot confirm
    [busy, contact, contactId, navigation, arkAddress, rotateReceiveAddress],
  );

  const onChatSendContinue = useCallback(
    (sats: number) => {
      if (!contact || busy) return;
      try {
        resolveChatPayDestination({ contactId });
      } catch (e) {
        Alert.alert(
          "No ark address",
          e instanceof Error
            ? e.message
            : "Add an ark address for this contact.",
        );
        return;
      }
      if (spendable != null && sats > spendable) {
        Alert.alert("Insufficient balance", "Enter an amount within your balance.");
        return;
      }
      setAmountSats(sats);
      setConfirmOpen(true);
    },
    [busy, contact, contactId, spendable],
  );

  async function onConfirmSend() {
    if (!amountSats || !contact) return;

    if (!wallet || selectedWallet?.kind !== "arkade") {
      Alert.alert("Wallet", "Select an Arkade wallet to send.");
      return;
    }

    setBusy(true);
    try {
      await executeChatPay({
        contactId,
        amountSats,
        requestId: null,
        hooks: {
          wallet,
          walletId: selectedWallet.id,
          networkId: network.id,
          spendable: spendable ?? null,
          beginOutboundSend,
          endOutboundSend,
          applyLocalSpend,
          getFreshArkAddress: async () => rotateReceiveAddress(),
          bumpActivity,
        },
      });
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.navigate("ChatThread", { contactId });
      }
    } catch (e) {
      Alert.alert("Send failed", e instanceof Error ? e.message : "Unknown error");
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  // Legacy deep-link / stale nav: Pay is biometrics-only from the request card.
  useEffect(() => {
    if (mode === "pay" && navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [mode, navigation]);

  if (!contact) {
    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={styles.title}>AMOUNT</Text>
        <Text style={styles.caption}>Contact not found.</Text>
      </ScreenChrome>
    );
  }

  if (mode === "pay") {
    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={styles.caption}>Use Pay on the request card.</Text>
      </ScreenChrome>
    );
  }

  if (mode === "request") {
    return (
      <View style={styles.posFill}>
        <ReceivePosPanel
          bip21Uri={null}
          onClose={() => navigation.goBack()}
          onRequestUri={() => null}
          variant="chat-request"
          contactLabel={name}
          onChatRequestConfirm={onChatRequestConfirm}
          chatRequestBusy={busy}
          fiatMode={fiatMode}
          active
        />
      </View>
    );
  }

  // Send — POS amount → Continue → Confirm send → biometrics
  if (!confirmOpen) {
    return (
      <View style={styles.posFill}>
        <ReceivePosPanel
          bip21Uri={null}
          onClose={() => navigation.goBack()}
          onRequestUri={() => null}
          variant="chat-send"
          contactLabel={name}
          onChatRequestConfirm={onChatSendContinue}
          chatRequestBusy={busy}
          fiatMode={fiatMode}
          active
        />
      </View>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={styles.title}>SEND</Text>
      <Text style={styles.caption}>
        {`To ${name}${destArk ? ` · ${midEllipsis(destArk, 8, 6)}` : ""}`}
      </Text>

      <View style={styles.confirmBox}>
        <Text style={styles.confirmTitle}>Confirm send</Text>
        <Text style={styles.confirmBody}>
          {(amountSats ?? 0).toLocaleString("en-US")} sats → {name}
        </Text>
        <Text style={styles.confirmHint}>Biometrics / App PIN required next.</Text>
      </View>

      <Pressable
        style={[styles.primary, busy && { opacity: 0.5 }]}
        disabled={busy}
        onPress={() => void onConfirmSend()}
        accessibilityRole="button"
        accessibilityLabel="Confirm send"
      >
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.primaryText}>Confirm send</Text>
        )}
      </Pressable>

      <Pressable
        style={styles.secondary}
        disabled={busy}
        onPress={() => {
          setConfirmOpen(false);
          setAmountSats(null);
        }}
      >
        <Text style={styles.secondaryText}>Back</Text>
      </Pressable>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  posFill: { flex: 1, backgroundColor: colors.bg },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 22,
    color: colors.fg,
    marginBottom: 6,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 16,
  },
  confirmBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    backgroundColor: colors.card,
  },
  confirmTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    marginBottom: 8,
  },
  confirmBody: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
  confirmHint: {
    marginTop: 12,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
  },
  primary: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000",
  },
  secondary: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
  },
});
