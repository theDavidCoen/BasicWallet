/**
 * Chat amount entry:
 * - Request → POS-style keypad (ReceivePosPanel chat-request), then Nostr pay-request
 * - Send / Pay → full-screen sats keypad + Confirm send + biometrics
 */

import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
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
import { formatSatsLabel } from "../wallet/formatSats";
import { colors } from "../theme/colors";
import { ReceivePosPanel } from "./ReceivePosPanel";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;

function parseAmountSats(raw: string): number | null {
  const n = Number.parseInt(raw.replace(/[,\s]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function ChatAmountScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ChatAmount">>();
  const { contactId, mode, requestId, amountSats: prefill, memo: prefillMemo } =
    route.params;
  const contact = useMemo(() => getContact(contactId), [contactId]);
  const { fiatMode } = useFiatMode();
  const {
    wallet,
    selectedWallet,
    balanceSats,
    balanceHidden,
    balance,
    beginOutboundSend,
    endOutboundSend,
    applyLocalSpend,
    arkAddress,
    rotateReceiveAddress,
    bumpActivity,
  } = useWallet();
  const network = getNetworkConfig();

  const [amountStr, setAmountStr] = useState(
    prefill && prefill > 0 ? String(prefill) : "",
  );
  const [memo, setMemo] = useState(prefillMemo ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const name = contact ? contactDisplayName(contact) : "Contact";
  const amount = parseAmountSats(amountStr);
  const spendable = balance?.available ?? balanceSats;
  const bal = formatSatsLabel(spendable, balanceHidden);
  const destArk = contact ? contactArkAddress(contact) : null;

  const title = mode === "pay" ? "PAY REQUEST" : "SEND";
  const primaryLabel = confirmOpen ? "Confirm send" : "Continue";

  const canContinue =
    amount != null &&
    !busy &&
    (spendable == null || amount <= spendable);

  function onKey(k: string) {
    if (k === "") return;
    if (k === "⌫") {
      setAmountStr((s) => s.slice(0, -1));
      return;
    }
    setAmountStr((s) => {
      if (s.length >= 10) return s;
      if (s === "0") return k;
      return s + k;
    });
  }

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
    async (amountSats: number) => {
      if (!contact || busy) return;
      setBusy(true);
      try {
        const preferredReceive = await ensurePreferredReceive();
        await sendPayRequest({
          contactId,
          amountSats,
          asset: "btc",
          preferredReceive,
        });
        // Pop amount screen so thread shows the pending request card.
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

  async function onPrimary() {
    if (!amount || !contact) return;

    // Send / Pay — Continue → Confirm send (+ biometrics inside execute)
    if (!confirmOpen) {
      try {
        resolveChatPayDestination({
          contactId,
          requestId: requestId ?? null,
        });
      } catch (e) {
        Alert.alert(
          "No ark address",
          e instanceof Error ? e.message : "Add an ark address for this contact.",
        );
        return;
      }
      setConfirmOpen(true);
      return;
    }

    if (!wallet || selectedWallet?.kind !== "arkade") {
      Alert.alert("Wallet", "Select an Arkade wallet to send.");
      return;
    }

    setBusy(true);
    try {
      await executeChatPay({
        contactId,
        amountSats: amount,
        memo: memo.trim() || undefined,
        requestId: requestId ?? null,
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

  if (!contact) {
    return (
      <ScreenChrome logoScale={0.77}>
        <Text style={styles.title}>AMOUNT</Text>
        <Text style={styles.caption}>Contact not found.</Text>
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

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.caption}>
        {`To ${name}${destArk ? ` · ${midEllipsis(destArk, 8, 6)}` : ""}`}
      </Text>

      <Pressable onPress={() => {}}>
        <Text style={styles.balancePill}>{bal}</Text>
      </Pressable>

      <Text style={styles.amountDisplay}>
        {(amount ?? 0).toLocaleString("en-US")}
        <Text style={styles.amountUnit}> sats</Text>
      </Text>

      {confirmOpen ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmTitle}>Confirm send</Text>
          <Text style={styles.confirmBody}>
            {(amount ?? 0).toLocaleString("en-US")} sats → {name}
          </Text>
          {memo.trim() ? (
            <Text style={styles.confirmMemo} numberOfLines={2}>
              {memo.trim()}
            </Text>
          ) : null}
          <Text style={styles.confirmHint}>Biometrics / App PIN required next.</Text>
        </View>
      ) : (
        <>
          <TextInput
            value={memo}
            onChangeText={setMemo}
            placeholder="Memo (optional)"
            placeholderTextColor={colors.hint}
            style={styles.memo}
            maxLength={280}
          />
          <View style={styles.keypad}>
            {KEYS.map((k, i) => (
              <Pressable
                key={`${k}-${i}`}
                style={[styles.key, k === "" && styles.keyEmpty]}
                disabled={k === "" || busy}
                onPress={() => onKey(k)}
              >
                <Text style={styles.keyText}>{k}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      <Pressable
        style={[styles.primary, (!canContinue || busy) && { opacity: 0.5 }]}
        disabled={!canContinue || busy}
        onPress={() => void onPrimary()}
        accessibilityRole="button"
        accessibilityLabel={primaryLabel}
      >
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.primaryText}>{primaryLabel}</Text>
        )}
      </Pressable>

      {confirmOpen ? (
        <Pressable
          style={styles.secondary}
          disabled={busy}
          onPress={() => setConfirmOpen(false)}
        >
          <Text style={styles.secondaryText}>Back</Text>
        </Pressable>
      ) : null}
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
  balancePill: {
    alignSelf: "flex-start",
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 18,
  },
  amountDisplay: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 40,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 16,
  },
  amountUnit: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 16,
    color: colors.caption,
  },
  memo: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    marginBottom: 16,
    backgroundColor: "#111",
  },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  key: {
    width: "31%",
    aspectRatio: 1.6,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keyEmpty: { borderWidth: 0 },
  keyText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 22,
    color: colors.fg,
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
  confirmMemo: {
    marginTop: 8,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
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
