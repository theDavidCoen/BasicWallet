/**
 * Chat amount entry:
 * - Request → POS keypad (ReceivePosPanel chat-request) → publish pay-request
 * - Send → POS keypad (chat-send, Continue) → Confirm → convert if needed → biometrics → send
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
import { ensureSatsForPay } from "../chat/ensureSatsForPay";
import {
  freezeFiatCaptionFromSats,
  formatSatsLine,
} from "../chat/formatChatAmount";
import type { ChatAsset } from "../chat/types";
import { getContact } from "../contacts/contactStore";
import { contactDisplayName, midEllipsis } from "../contacts/types";
import { getNetworkConfig } from "../config/network";
import {
  fetchFiatSpot,
  formatBrlDisplay,
  padSatsForDepixSwap,
  satsToFiatEstimate,
} from "../fiat/depixAssets";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { useWallet } from "../wallet/WalletProvider";
import { colors } from "../theme/colors";
import { ReceivePosPanel } from "./ReceivePosPanel";

export function ChatAmountScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ChatAmount">>();
  const { contactId, mode } = route.params;
  const contact = useMemo(() => getContact(contactId), [contactId]);
  const {
    fiatMode,
    convertDepixToSatsForPay,
    depixDisplay,
  } = useFiatMode();
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
  const [fiatDisplayTyped, setFiatDisplayTyped] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [spot, setSpot] = useState<number | null>(null);

  const name = contact ? contactDisplayName(contact) : "Contact";
  const spendable = balance?.available ?? balanceSats;
  const destArk = contact ? contactArkAddress(contact) : null;

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
    async (sats: number, meta?: { fiatDisplay?: number }) => {
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
        // Fiat requester: pad amountSats for inbound sats→stable swap fees.
        const wireSats = fiatMode
          ? padSatsForDepixSwap(sats, network.id)
          : sats;
        const asset: ChatAsset = fiatMode
          ? network.id === "mutinynet"
            ? "usdt"
            : "depix"
          : "btc";
        let fiatCaption: string | null = null;
        if (fiatMode) {
          if (meta?.fiatDisplay != null && meta.fiatDisplay > 0) {
            fiatCaption = formatBrlDisplay(meta.fiatDisplay, {
              networkId: network.id,
            });
          } else {
            const s = spot ?? (await fetchFiatSpot(network.id));
            fiatCaption = freezeFiatCaptionFromSats(sats, s, network.id);
          }
        }
        await sendPayRequest({
          contactId,
          amountSats: wireSats,
          asset,
          preferredReceive,
          fiatCaption,
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
    [
      busy,
      contact,
      contactId,
      navigation,
      arkAddress,
      rotateReceiveAddress,
      fiatMode,
      network.id,
      spot,
    ],
  );

  const onChatSendContinue = useCallback(
    (sats: number, meta?: { fiatDisplay?: number }) => {
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
      const have = spendable ?? 0;
      if (sats > have) {
        if (!(fiatMode && (depixDisplay ?? 0) > 0)) {
          Alert.alert(
            "Insufficient balance",
            "Enter an amount within your balance.",
          );
          return;
        }
        // Fiat Mode with stable balance — convert on Confirm (one-shot).
      }
      setAmountSats(sats);
      setFiatDisplayTyped(
        meta?.fiatDisplay != null && meta.fiatDisplay > 0
          ? meta.fiatDisplay
          : null,
      );
      setConfirmOpen(true);
    },
    [busy, contact, contactId, spendable, fiatMode, depixDisplay],
  );

  const needConvert = useMemo(() => {
    if (!fiatMode || amountSats == null) return false;
    const have = spendable ?? 0;
    return amountSats > have;
  }, [fiatMode, amountSats, spendable]);

  const confirmBody = useMemo(() => {
    const sats = amountSats ?? 0;
    const satsLine = formatSatsLine(sats);
    if (!fiatMode) {
      return `${satsLine} → ${name}`;
    }
    let stablePrimary: string | null = null;
    if (fiatDisplayTyped != null && fiatDisplayTyped > 0) {
      stablePrimary = formatBrlDisplay(fiatDisplayTyped, {
        networkId: network.id,
      });
    } else if (spot != null && spot > 0) {
      const est = satsToFiatEstimate(sats, spot, network.id);
      if (est != null) {
        stablePrimary = formatBrlDisplay(est, { networkId: network.id });
      }
    }
    if (needConvert) {
      const approx = stablePrimary ?? "stable balance";
      return `Convert ~${approx} to sats, then send ${satsLine}? Fee applies.`;
    }
    if (stablePrimary) {
      return `${stablePrimary} (≈ ${satsLine}) → ${name}`;
    }
    return `${satsLine} → ${name}`;
  }, [
    amountSats,
    fiatMode,
    fiatDisplayTyped,
    spot,
    needConvert,
    name,
    network.id,
  ]);

  async function onConfirmSend() {
    if (!amountSats || !contact) return;

    if (!wallet || selectedWallet?.kind !== "arkade") {
      Alert.alert("Wallet", "Select an Arkade wallet to send.");
      return;
    }

    setBusy(true);
    try {
      // One-shot: convert if needed → biometrics → send.
      const ensured = await ensureSatsForPay({
        satsNeeded: amountSats,
        spendable: spendable ?? null,
        fiatMode,
        depixDisplay,
        networkId: network.id,
        convertDepixToSatsForPay,
      });

      let fiatCaption: string | null = null;
      if (fiatMode) {
        if (fiatDisplayTyped != null && fiatDisplayTyped > 0) {
          fiatCaption = formatBrlDisplay(fiatDisplayTyped, {
            networkId: network.id,
          });
        } else {
          const s = spot ?? (await fetchFiatSpot(network.id));
          fiatCaption = freezeFiatCaptionFromSats(amountSats, s, network.id);
        }
      }

      await executeChatPay({
        contactId,
        amountSats,
        requestId: null,
        fiatCaption,
        hooks: {
          wallet,
          walletId: selectedWallet.id,
          networkId: network.id,
          spendable: ensured.spendable ?? spendable ?? null,
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

  // Send — POS amount → Continue → Confirm → convert if needed → biometrics
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
        <Text style={styles.confirmBody}>{confirmBody}</Text>
        <Text style={styles.confirmHint}>
          {needConvert
            ? "Converts first, then biometrics / App PIN for the send."
            : "Biometrics / App PIN required next."}
        </Text>
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
          <Text style={styles.primaryText}>
            {needConvert ? "Convert & send" : "Confirm send"}
          </Text>
        )}
      </Pressable>

      <Pressable
        style={styles.secondary}
        disabled={busy}
        onPress={() => {
          setConfirmOpen(false);
          setAmountSats(null);
          setFiatDisplayTyped(null);
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
