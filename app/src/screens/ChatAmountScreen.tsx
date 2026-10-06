/**
 * Chat amount entry:
 * - Request → POS keypad (ReceivePosPanel chat-request) → publish pay-request
 * - Send → POS keypad (chat-send, Confirm) → biometrics → leave to thread →
 *   quiet convert (if needed) + send with bubble status (converting → sending → paid)
 * Pay-from-request never lands here (biometrics-only from the request card).
 */

import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { isValidArkAddress } from "@arkade-os/sdk";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { sendPayRequest } from "../chat/chatActions";
import {
  getChatMessage,
  insertChatMessage,
  updateChatMessage,
} from "../chat/chatStore";
import {
  executeChatPay,
  resolveChatPayDestination,
} from "../chat/executeChatPay";
import { ensureChatPayWallet } from "../chat/ensureChatPayWallet";
import { ensureSatsForPay } from "../chat/ensureSatsForPay";
import { freezeFiatCaptionFromSats } from "../chat/formatChatAmount";
import type { ChatAsset } from "../chat/types";
import { newChatId } from "../chat/types";
import { getContact } from "../contacts/contactStore";
import { contactDisplayName } from "../contacts/types";
import { getNetworkConfig } from "../config/network";
import {
  fetchFiatSpot,
  formatBrlDisplay,
  padSatsForDepixSwap,
} from "../fiat/depixAssets";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { tryRequestArkadeLnReceive } from "../lightning/arkadeLnSwap";
import { requireUserPresence } from "../security/userPresence";
import { DEFAULT_MIN_VTXO_SATS } from "../wallet/arkMultiSend";
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
    holdAutoInboundForPay,
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
    refreshActivity,
  } = useWallet();
  const network = getNetworkConfig();

  const [busy, setBusy] = useState(false);
  const [spot, setSpot] = useState<number | null>(null);

  const name = contact ? contactDisplayName(contact) : "Contact";
  const spendable = balance?.available ?? balanceSats;

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
        let lightningInvoice: string | undefined;
        if (!fiatMode && wallet && selectedWallet?.id) {
          const minted = await tryRequestArkadeLnReceive({
            wallet,
            networkId: network.id,
            walletId: selectedWallet.id,
            amountSats: wireSats,
          });
          if (minted?.bolt11) lightningInvoice = minted.bolt11;
        }
        await sendPayRequest({
          contactId,
          amountSats: wireSats,
          asset,
          preferredReceive,
          fiatCaption,
          lightningInvoice,
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
      wallet,
      selectedWallet?.id,
    ],
  );

  /**
   * Confirm on POS → biometrics first → leave to ChatThread → quiet convert
   * (if needed) + send. Progress lives on the payment bubble, not the global
   * Fiat Mode converting overlay.
   */
  const onChatSendConfirm = useCallback(
    async (sats: number, meta?: { fiatDisplay?: number }) => {
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

      const payWallet = await ensureChatPayWallet({ wallet, selectedWallet });
      if (!payWallet.ok) {
        Alert.alert("Wallet", payWallet.message);
        return;
      }

      const haveUi = spendable ?? 0;
      // Fiat: Home is stable — UI sats floors are often optimistic (pay-convert).
      // Always take the convert path when DePix is shown; ensureSatsForPay reads
      // live ASP sats and skips convert only when they truly cover the pay.
      const needConvert = fiatMode && (depixDisplay ?? 0) > 0;
      if (!fiatMode && sats > haveUi) {
        Alert.alert(
          "Insufficient balance",
          "Enter an amount within your balance.",
        );
        return;
      }
      if (fiatMode && !needConvert && sats > haveUi) {
        Alert.alert(
          "Insufficient balance",
          "Not enough sats, and no stable balance to convert.",
        );
        return;
      }

      setBusy(true);
      try {
        // Auth before any convert / send I/O.
        const auth = await requireUserPresence("Confirm send");
        if (!auth.ok) {
          Alert.alert(
            "Authentication required",
            auth.reason || "Confirm with biometrics or App PIN to send.",
          );
          return;
        }

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

        const paymentId = newChatId("pay");
        // Fiat Mode with DePix: always start as converting — ensureSats may no-op
        // if live sats already cover the pay (bubble advances to sending).
        const local = insertChatMessage({
          contactId,
          kind: "payment",
          direction: "out",
          amountSats: sats,
          fiatCaption,
          status: needConvert ? "converting" : "sending",
          paymentId,
        });

        // Leave Send immediately — bubble owns converting/sending/paid.
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate("ChatThread", { contactId });
        }

        // Capture hooks for post-unmount background work.
        const hooks = {
          wallet: payWallet.wallet,
          walletId: payWallet.walletId,
          networkId: network.id,
          spendable: spendable ?? null,
          beginOutboundSend,
          endOutboundSend,
          applyLocalSpend,
          getFreshArkAddress: async () => rotateReceiveAddress(),
          bumpActivity,
          refreshActivity,
        };
        const convert = convertDepixToSatsForPay;
        const fiatOn = fiatMode;
        const depix = depixDisplay;
        const netId = network.id;
        const spendNow = spendable ?? null;

        void (async () => {
          const payDeadline = Date.now() + 4 * 60_000;
          const payTimedOut = () => Date.now() > payDeadline;
          // Pause ASP polls before ensureSats/getBalance so Xiaomi send isn't starved (α73).
          beginOutboundSend();
          try {
            // Hold auto-inbound for leftover / pre-existing sats during send.
            holdAutoInboundForPay(180_000);
            if (needConvert) {
              updateChatMessage(local.id, { status: "converting" });
            }
            const readLiveSpendableSats = async (): Promise<number | null> => {
              try {
                const raw = await payWallet.wallet.getBalance();
                if (
                  raw &&
                  typeof raw === "object" &&
                  typeof (raw as { available?: unknown }).available === "number"
                ) {
                  return Math.floor((raw as { available: number }).available);
                }
              } catch (e) {
                console.warn("[basic] chat send live sats read failed", e);
              }
              return null;
            };
            const ensured = await ensureSatsForPay({
              satsNeeded: sats,
              spendable: spendNow,
              fiatMode: fiatOn,
              depixDisplay: depix,
              networkId: netId,
              convertDepixToSatsForPay: convert,
              quiet: true,
              readLiveSpendableSats,
            });
            if (payTimedOut()) {
              throw new Error("Conversion timed out. Try again.");
            }
            holdAutoInboundForPay(180_000);
            updateChatMessage(local.id, { status: "sending" });
            await executeChatPay({
              contactId,
              amountSats: sats,
              requestId: null,
              fiatCaption,
              skipPresence: true,
              localMessageId: local.id,
              paymentId,
              hooks: {
                ...hooks,
                spendable: ensured.spendable ?? spendNow,
              },
            });
          } catch (e) {
            // executeChatPay may have late-settled → paid; don't overwrite / alert.
            const cur = getChatMessage(local.id);
            if (cur?.status === "paid") {
              console.warn("[basic] chat send recovered as paid after error");
              return;
            }
            updateChatMessage(local.id, { status: "failed" });
            const msg = e instanceof Error ? e.message : String(e);
            console.warn("[basic] chat send background failed", msg);
            // Re-read: spend-drop reconcile can flip paid between checks (α75).
            const again = getChatMessage(local.id);
            if (again?.status === "paid") return;
            Alert.alert("Send failed", msg);
          } finally {
            endOutboundSend();
          }
        })();
      } catch (e) {
        Alert.alert(
          "Send failed",
          e instanceof Error ? e.message : "Unknown error",
        );
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      contact,
      contactId,
      spendable,
      fiatMode,
      depixDisplay,
      wallet,
      selectedWallet,
      network.id,
      convertDepixToSatsForPay,
      holdAutoInboundForPay,
      spot,
      beginOutboundSend,
      endOutboundSend,
      applyLocalSpend,
      rotateReceiveAddress,
      bumpActivity,
      refreshActivity,
      navigation,
    ],
  );

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

  // Send — POS amount → Confirm → biometrics → thread + bubble progress
  return (
    <View style={styles.posFill}>
      <ReceivePosPanel
        bip21Uri={null}
        onClose={() => navigation.goBack()}
        onRequestUri={() => null}
        variant="chat-send"
        contactLabel={name}
        onChatRequestConfirm={onChatSendConfirm}
        chatRequestBusy={busy}
        fiatMode={fiatMode}
        maxSpendableSats={spendable ?? null}
        maxFiatDisplay={depixDisplay ?? null}
        active
      />
    </View>
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
});
