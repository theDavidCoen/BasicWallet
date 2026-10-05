import * as Clipboard from "expo-clipboard";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  InteractionManager,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import type { RootNav } from "../navigation/types";
import { ExpandableQrCode } from "../components/ExpandableQrCode";
import { ScreenChrome } from "../components/ScreenChrome";
import { SHEET_SPRING } from "../components/sheet/sheetMotion";
import { getNetworkConfig } from "../config/network";
import { syncLightningHistory, upsertLightningPayments } from "../account/lightningActivity";
import {
  lndhubCreateInvoice,
  lndhubInvoiceStatus,
  type LndHubInvoice,
} from "../lightning/lndhub";
import { loadLndHubCredentials } from "../lightning/lndhubCredentials";
import { useSheets } from "../navigation/SheetHost";
import { encodeReceiveBip21 } from "../wallet/bip21Receive";
import { encodeReceiveBip21Asset } from "../wallet/bip21Asset";
import { useWallet } from "../wallet/WalletProvider";
import { formatSatsLabel } from "../wallet/formatSats";
import { AdaptiveText, useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ReceivePosPanel } from "./ReceivePosPanel";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { depixAssetIdForNetwork, fiatStableForNetwork, formatBrlDisplay, padSatsForDepixSwap } from "../fiat/depixAssets";

type ReceiveMode = "bip21" | "arkade" | "boarding" | "brl";

function midEllipsis(s: string, left = 16, right = 6): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

export function ReceiveScreen() {
  const { t } = useI18n();
  const navigation = useNavigation<RootNav>();
  const { openFundsReceived } = useSheets();
  const {
    arkAddress,
    boardingAddress,
    boardingError,
    balanceSats,
    balance,
    balanceHidden,
    toggleBalanceHidden,
    selectedWallet,
    rotateReceiveAddress,
    rotateBoardingAddress,
    ensureBoardingAddress,
    refresh,
    refreshBalanceOnly,
    bumpActivity,
    setPosUiHold,
    setIncomingWatchBoost,
  } = useWallet();
  const { fiatMode, depixDisplay } = useFiatMode();
  const network = getNetworkConfig();
  const [mode, setMode] = useState<ReceiveMode>(fiatMode ? "brl" : "bip21");
  const [busy, setBusy] = useState(false);
  const [boardingLoading, setBoardingLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  /** Fiat Mode: classic Receive is the overlay; POS is the default page. */
  const [classicOpen, setClassicOpen] = useState(false);
  const [brlAmount, setBrlAmount] = useState("0");

  useEffect(() => {
    setMode(fiatMode ? "brl" : "bip21");
    if (!fiatMode) setClassicOpen(false);
  }, [fiatMode]);

  // Whole Receive scene awaits inbound — chat prefer must not swallow classic (α77).
  // α87: useFocusEffect so boost clears when Send (or anything) covers Receive —
  // mount-only useEffect left boost on under Send and toasted change (α78).
  useFocusEffect(
    useCallback(() => {
      setIncomingWatchBoost(true);
      return () => setIncomingWatchBoost(false);
    }, [setIncomingWatchBoost]),
  );

  useEffect(() => {
    const hold = fiatMode ? classicOpen : posOpen;
    if (!hold) return;
    setPosUiHold(true);
    return () => setPosUiHold(false);
  }, [fiatMode, classicOpen, posOpen, setPosUiHold]);

  const windowW = Dimensions.get("window").width;
  /** Off-screen left — same side as Home POS (`InteractiveSideSheet` side="left"). */
  const overlayOffX = -windowW;
  const overlayX = useSharedValue(overlayOffX);
  const overlayDragStart = useSharedValue(overlayOffX);
  const overlayDir = useSharedValue(0);
  const overlayOpenSV = useSharedValue(0);

  /** Commit open only after snap — never enable sheet hits mid-drag. */
  const commitOverlayOpen = useCallback(() => {
    overlayOpenSV.value = 1;
    if (fiatMode) setClassicOpen(true);
    else setPosOpen(true);
  }, [fiatMode, overlayOpenSV]);

  const openOverlay = useCallback(() => {
    overlayOpenSV.value = 1;
    cancelAnimation(overlayX);
    overlayX.value = withSpring(0, SHEET_SPRING, (finished) => {
      if (finished) runOnJS(commitOverlayOpen)();
    });
  }, [commitOverlayOpen, overlayOpenSV, overlayX]);

  const closeOverlay = useCallback(() => {
    cancelAnimation(overlayX);
    overlayX.value = withSpring(overlayOffX, SHEET_SPRING, (finished) => {
      if (finished) {
        overlayOpenSV.value = 0;
        if (fiatMode) runOnJS(setClassicOpen)(false);
        else runOnJS(setPosOpen)(false);
      }
    });
  }, [fiatMode, overlayOffX, overlayOpenSV, overlayX]);

  /** Visual drag started — keep React hits off until commitOverlayOpen. */
  const beginOverlayDrag = useCallback(() => {
    overlayOpenSV.value = 1;
  }, [overlayOpenSV]);

  const finishOverlayDismiss = useCallback(() => {
    overlayOpenSV.value = 0;
    if (fiatMode) setClassicOpen(false);
    else setPosOpen(false);
  }, [fiatMode, overlayOpenSV]);

  const isLightning = selectedWallet?.kind === "lightning";

  // Non–Fiat Mode: POS stays an overlay (opened on demand). Fiat Mode: POS is
  // the default page — no auto-open overlay.

  // —— Lightning receive ——
  const [lnAmount, setLnAmount] = useState("");
  const [lnMemo, setLnMemo] = useState("");
  const [lnInvoice, setLnInvoice] = useState<LndHubInvoice | null>(null);
  const [lnSettled, setLnSettled] = useState(false);
  const [lnBusy, setLnBusy] = useState(false);
  const settleStopRef = useRef(false);

  const loadBoarding = useCallback(async () => {
    setBoardingLoading(true);
    try {
      await ensureBoardingAddress();
    } catch {
      // boardingError is set on the provider
    } finally {
      setBoardingLoading(false);
    }
  }, [ensureBoardingAddress]);

  const needsBoarding = mode === "boarding" || mode === "bip21";

  useEffect(() => {
    if (isLightning || !needsBoarding) return;
    if (boardingAddress || boardingLoading || boardingError) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void loadBoarding();
    });
    return () => {
      try {
        (task as { cancel?: () => void }).cancel?.();
      } catch {
        /* ignore */
      }
    };
  }, [
    isLightning,
    needsBoarding,
    boardingAddress,
    boardingLoading,
    boardingError,
    loadBoarding,
  ]);

  // BIP21 / Boarding: cheap getBalance only — defer first pull so navigate paints first.
  useEffect(() => {
    if (isLightning || !needsBoarding) return;
    const first = setTimeout(() => {
      void refreshBalanceOnly();
    }, 400);
    const id = setInterval(() => {
      void refreshBalanceOnly();
    }, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [isLightning, needsBoarding, refreshBalanceOnly]);

  // Poll invoice settle while Lightning invoice is showing (cancellable timer).
  useEffect(() => {
    if (!isLightning || !lnInvoice || lnSettled) return;
    settleStopRef.current = false;
    const walletId = selectedWallet?.id;
    if (!walletId) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || settleStopRef.current) return;
      try {
        const hub = await loadLndHubCredentials(walletId);
        if (!hub) return;
        const status = await lndhubInvoiceStatus(hub, lnInvoice.paymentHash);
        if (cancelled || settleStopRef.current) return;
        if (status.paid) {
          setLnSettled(true);
          const paymentHash = lnInvoice.paymentHash.toLowerCase();
          upsertLightningPayments(network.id, walletId, [
            {
              id: `ln-in-${paymentHash}`,
              amountSats: lnInvoice.amountSats,
              direction: "in",
              createdAt: Date.now(),
              settled: true,
              memo: lnInvoice.memo,
              paymentHash,
              preimage: status.preimage,
            },
          ]);
          bumpActivity();
          await refresh();
          // Replace ghosts (pending from older builds / hash mismatch) with hub history.
          try {
            await syncLightningHistory(network.id, walletId);
            bumpActivity();
          } catch {
            /* optional */
          }
          const amount = lnInvoice.amountSats;
          navigation.navigate("Home");
          requestAnimationFrame(() => {
            openFundsReceived({ amount, kind: "lightning" });
          });
        }
      } catch (e) {
        console.warn("[basic] ln invoice poll", e);
      }
    };

    void tick();
    const id = setInterval(() => {
      void tick();
    }, 3_000);
    return () => {
      cancelled = true;
      settleStopRef.current = true;
      clearInterval(id);
    };
  }, [
    isLightning,
    lnInvoice,
    lnSettled,
    selectedWallet?.id,
    network.id,
    bumpActivity,
    refresh,
    navigation,
    openFundsReceived,
  ]);

  // Future: LN invoice from Arkade swap corridor → pass as 3rd arg.
  const bip21Uri = useMemo(
    () => encodeReceiveBip21(boardingAddress, arkAddress, null),
    [boardingAddress, arkAddress],
  );

  const brlUri = useMemo(() => {
    if (!arkAddress) return null;
    const amt = Number(brlAmount);
    const display = Number.isFinite(amt) && amt > 0 ? amt : 0;
    try {
      return encodeReceiveBip21Asset(
        arkAddress,
        depixAssetIdForNetwork(network.id),
        display > 0 ? display : 0,
      );
    } catch {
      return null;
    }
  }, [arkAddress, brlAmount, network.id]);

  const buildPosBip21 = useCallback(
    (amountSats: number) => {
      const sats = fiatMode ? padSatsForDepixSwap(amountSats) : amountSats;
      return encodeReceiveBip21(boardingAddress, arkAddress, null, sats);
    },
    [boardingAddress, arkAddress, fiatMode],
  );

  const buildPosBrlUri = useCallback(
    (brlDisplay: number) => {
      if (!arkAddress || !(brlDisplay > 0)) return null;
      try {
        return encodeReceiveBip21Asset(
          arkAddress,
          depixAssetIdForNetwork(network.id),
          brlDisplay,
        );
      } catch {
        return null;
      }
    },
    [arkAddress, network.id],
  );

  /**
   * Overlay sheet (POS when not fiat; classic Receive when fiat) slides in from
   * the left (L→R open). Never wrap the keypad in a Pan — that steals taps.
   */
  const overlayOpenPan = useMemo(() => {
    if (isLightning) return Gesture.Pan().enabled(false);
    return Gesture.Pan()
      .activeOffsetX([-14, 14])
      .failOffsetY([-40, 40])
      .onBegin(() => {
        "worklet";
        if (overlayOpenSV.value === 1) {
          overlayDir.value = 0;
          return;
        }
        overlayDir.value = 0;
      })
      .onUpdate((e) => {
        "worklet";
        if (overlayOpenSV.value === 1 && overlayDir.value === 0) return;
        const dx = e.translationX;
        if (overlayDir.value === 0) {
          if (dx > 10) {
            overlayDir.value = 1;
            cancelAnimation(overlayX);
            overlayX.value = overlayOffX;
            overlayDragStart.value = overlayOffX;
            runOnJS(beginOverlayDrag)();
          } else {
            return;
          }
        }
        if (overlayDir.value === 1) {
          const next = overlayOffX + dx;
          overlayX.value = Math.max(overlayOffX, Math.min(0, next));
        }
      })
      .onEnd((e) => {
        "worklet";
        const dir = overlayDir.value;
        overlayDir.value = 0;
        if (dir !== 1) return;
        const open = overlayX.value > overlayOffX * 0.55 || e.velocityX > 600;
        if (open) {
          overlayX.value = withSpring(0, SHEET_SPRING, (finished) => {
            if (finished) runOnJS(commitOverlayOpen)();
          });
        } else {
          overlayX.value = withSpring(overlayOffX, SHEET_SPRING, (finished) => {
            if (finished) runOnJS(finishOverlayDismiss)();
          });
        }
      });
  }, [
    beginOverlayDrag,
    commitOverlayOpen,
    finishOverlayDismiss,
    isLightning,
    overlayDir,
    overlayDragStart,
    overlayOffX,
    overlayOpenSV,
    overlayX,
  ]);

  /** Dismiss overlay: right-edge grabber, swipe left. */
  const overlayClosePan = useMemo(() => {
    return Gesture.Pan()
      .activeOffsetX([-16, 16])
      .failOffsetY([-32, 32])
      .onBegin(() => {
        "worklet";
        cancelAnimation(overlayX);
        overlayDragStart.value = overlayX.value;
      })
      .onUpdate((e) => {
        "worklet";
        const next = overlayDragStart.value + e.translationX;
        overlayX.value = Math.max(overlayOffX, Math.min(0, next));
      })
      .onEnd((e) => {
        "worklet";
        const close = overlayX.value < overlayOffX * 0.5 || e.velocityX < -600;
        if (close) {
          overlayX.value = withSpring(overlayOffX, SHEET_SPRING, (finished) => {
            if (finished) runOnJS(finishOverlayDismiss)();
          });
        } else {
          overlayX.value = withSpring(0, SHEET_SPRING);
        }
      });
  }, [finishOverlayDismiss, overlayDragStart, overlayOffX, overlayX]);

  const overlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: overlayX.value }],
  }));

  const receiveOpenGesture = useMemo(
    () => Gesture.Simultaneous(Gesture.Native(), overlayOpenPan),
    [overlayOpenPan],
  );

  const displayPayload =
    mode === "brl"
      ? brlUri
      : mode === "bip21"
        ? bip21Uri
        : mode === "arkade"
          ? arkAddress
          : boardingAddress;

  const bal = fiatMode
    ? formatBrlDisplay(depixDisplay ?? 0, { hidden: balanceHidden, networkId: network.id })
    : formatSatsLabel(balanceSats, balanceHidden);
  const boardingSats = balance?.boarding ?? 0;
  const boardingLabel = balanceHidden
    ? "******"
    : boardingSats.toLocaleString("en-US");

  const fiatLabel = fiatStableForNetwork(network.id);
  const caption = fiatMode
    ? mode === "brl"
      ? `${fiatLabel.displayCode} (${fiatLabel.ticker}) · ${network.label}`
      : mode === "bip21"
        ? `Universal BIP21 · ${network.label}`
        : `Arkade · ${network.label}`
    : mode === "bip21"
      ? `BIP21 · boarding + Arkade · ${network.label}`
      : mode === "arkade"
        ? `Arkade · ${network.label}`
        : `Onchain boarding · ${network.label}`;

  const qrReady =
    mode === "brl"
      ? Boolean(brlUri && arkAddress)
      : mode === "bip21"
        ? Boolean(bip21Uri && (boardingAddress || arkAddress))
        : Boolean(displayPayload);

  const showBoardingSpinner =
    !fiatMode &&
    (mode === "boarding" || mode === "bip21") &&
    boardingLoading &&
    !boardingAddress;

  async function onCopy() {
    const text = isLightning ? lnInvoice?.paymentRequest : displayPayload;
    if (!text) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function onShare() {
    const text = isLightning ? lnInvoice?.paymentRequest : displayPayload;
    if (!text) return;
    await Share.share({ message: text });
  }

  async function onNewArkAddress() {
    setBusy(true);
    try {
      await rotateReceiveAddress();
    } catch (e) {
      Alert.alert("Could not rotate address", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function onNewBoardingAddress() {
    setBusy(true);
    try {
      await rotateBoardingAddress();
    } catch (e) {
      Alert.alert("Could not rotate address", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateLnInvoice() {
    const amount = Number.parseInt(lnAmount.replace(/[,\s]/g, ""), 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Invalid amount", "Enter a positive amount in sats.");
      return;
    }
    const walletId = selectedWallet?.id;
    if (!walletId) {
      Alert.alert("No Lightning wallet", "Connect a node first.");
      return;
    }
    setLnBusy(true);
    try {
      const hub = await loadLndHubCredentials(walletId);
      if (!hub) {
        throw new Error("LNDHub not connected for this wallet");
      }
      const inv = await lndhubCreateInvoice(hub, {
        amountSats: amount,
        memo: lnMemo.trim() || undefined,
      });
      setLnInvoice(inv);
      setLnSettled(false);
    } catch (e) {
      Alert.alert(
        "Could not create invoice",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setLnBusy(false);
    }
  }

  function onNewLnInvoice() {
    settleStopRef.current = true;
    setLnInvoice(null);
    setLnSettled(false);
    setCopied(false);
  }

  if (isLightning) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>{t("receive.title")}</Text>
          <Pressable onPress={toggleBalanceHidden}>
            <Text style={styles.balance}>{bal}</Text>
          </Pressable>
          <Text style={styles.caption}>
            Lightning · {selectedWallet?.label ?? "node"}
          </Text>

          {!lnInvoice ? (
            <>
              <Text style={styles.fieldLabel}>{t("receive.amountSats")}</Text>
              <TextInput
                value={lnAmount}
                onChangeText={setLnAmount}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.hint}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>{t("receive.memoOptional")}</Text>
              <TextInput
                value={lnMemo}
                onChangeText={setLnMemo}
                placeholder="Basic"
                placeholderTextColor={colors.hint}
                style={styles.input}
              />
              <Pressable
                style={[styles.primary, lnBusy && { opacity: 0.6 }]}
                disabled={lnBusy}
                onPress={() => void onCreateLnInvoice()}
              >
                {lnBusy ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <AdaptiveText style={styles.primaryText} baseFontSize={15}>{t("receive.createInvoice")}</AdaptiveText>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.qrWrap}>
                <ExpandableQrCode value={lnInvoice.paymentRequest} size={220} />
              </View>
              <Text style={styles.lnStatus}>
                {lnSettled
                  ? "Paid"
                  : `${lnInvoice.amountSats.toLocaleString("en-US")} sats · waiting…`}
              </Text>
              {lnInvoice.memo ? (
                <Text style={styles.boardingHint}>{lnInvoice.memo}</Text>
              ) : null}
              <View style={styles.pillRow}>
                <View style={styles.pill}>
                  <Text style={styles.pillText} numberOfLines={2}>
                    {midEllipsis(lnInvoice.paymentRequest, 18, 12)}
                  </Text>
                </View>
                <Pressable style={styles.icoBtn} onPress={() => void onCopy()}>
                  <Text style={styles.icoLabel}>{copied ? "✓" : "Copy"}</Text>
                </Pressable>
                <Pressable style={styles.icoBtn} onPress={() => void onShare()}>
                  <Text style={styles.icoLabel}>{t("common.share")}</Text>
                </Pressable>
              </View>
              <Pressable style={styles.secondary} onPress={onNewLnInvoice}>
                <AdaptiveText style={styles.secondaryText} baseFontSize={14}>{t("receive.newInvoice")}</AdaptiveText>
              </Pressable>
            </>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </ScreenChrome>
    );
  }

  const classicBody = (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Text style={styles.title}>{t("receive.title")}</Text>
        <Pressable onPress={toggleBalanceHidden} onLongPress={() => void refresh()}>
          <Text style={styles.balance}>{bal}</Text>
        </Pressable>
        <Text style={styles.caption}>{caption}</Text>

        <View style={styles.modeRow}>
          {fiatMode ? (
            <>
              <Pressable
                style={[styles.modeBtn, mode === "brl" && styles.modeBtnOn]}
                onPress={() => setMode("brl")}
              >
                <Text style={[styles.modeLabel, mode === "brl" && styles.modeLabelOn]}>
                  {fiatLabel.displayCode}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, mode === "bip21" && styles.modeBtnOn]}
                onPress={() => setMode("bip21")}
              >
                <Text style={[styles.modeLabel, mode === "bip21" && styles.modeLabelOn]}>
                  Universal BIP21
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, mode === "arkade" && styles.modeBtnOn]}
                onPress={() => setMode("arkade")}
              >
                <Text style={[styles.modeLabel, mode === "arkade" && styles.modeLabelOn]}>
                  Arkade
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[styles.modeBtn, mode === "bip21" && styles.modeBtnOn]}
                onPress={() => setMode("bip21")}
              >
                <Text style={[styles.modeLabel, mode === "bip21" && styles.modeLabelOn]}>
                  BIP21
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, mode === "arkade" && styles.modeBtnOn]}
                onPress={() => setMode("arkade")}
              >
                <Text style={[styles.modeLabel, mode === "arkade" && styles.modeLabelOn]}>
                  Arkade
                </Text>
              </Pressable>
              <Pressable
                style={[styles.modeBtn, mode === "boarding" && styles.modeBtnOn]}
                onPress={() => setMode("boarding")}
              >
                <Text style={[styles.modeLabel, mode === "boarding" && styles.modeLabelOn]}>
                  Boarding
                </Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.qrWrap}>
          {qrReady && displayPayload ? (
            <ExpandableQrCode value={displayPayload} size={220} />
          ) : (
            <View style={styles.qrPlaceholder}>
              <ActivityIndicator color="#000" />
            </View>
          )}
        </View>

        <View style={styles.pillRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText} numberOfLines={1}>
              {displayPayload
                ? midEllipsis(displayPayload, mode === "bip21" ? 18 : 14, 8)
                : "loading…"}
            </Text>
          </View>
          <Pressable
            style={styles.icoBtn}
            onPress={() => void onCopy()}
            disabled={!displayPayload}
          >
            <Text style={styles.icoLabel}>{copied ? "✓" : "Copy"}</Text>
          </Pressable>
          <Pressable
            style={styles.icoBtn}
            onPress={() => void onShare()}
            disabled={!displayPayload}
          >
            <Text style={styles.icoLabel}>{t("common.share")}</Text>
          </Pressable>
        </View>

        {mode === "boarding" ? (
          <>
            {boardingError && !boardingAddress ? (
              <Text style={styles.errorText}>{boardingError}</Text>
            ) : (
              <Text style={styles.boardingHint}>
                Fund this onchain address (faucet / L1). Boarding settles into Arkade
                automatically after confirmation.
                {boardingSats > 0
                  ? `\nBoarding pending: ${boardingLabel} sats`
                  : ""}
              </Text>
            )}
            <Pressable
              style={[styles.secondary, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => void onNewBoardingAddress()}
            >
              {busy ? (
                <ActivityIndicator color={colors.fg} />
              ) : (
                <AdaptiveText style={styles.secondaryText} baseFontSize={14}>{t("receive.newReceiveAddress")}</AdaptiveText>
              )}
            </Pressable>
          </>
        ) : mode === "bip21" ? (
          <>
            {boardingError && !boardingAddress && !arkAddress ? (
              <Text style={styles.errorText}>{boardingError}</Text>
            ) : (
              <Text style={styles.boardingHint}>
                Unified URI: onchain boarding + Arkade address
                {boardingSats > 0
                  ? `\nBoarding pending: ${boardingLabel} sats`
                  : ""}
              </Text>
            )}
            <Pressable
              style={[styles.secondary, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => void onNewArkAddress()}
            >
              {busy ? (
                <ActivityIndicator color={colors.fg} />
              ) : (
                <AdaptiveText style={styles.secondaryText} baseFontSize={14}>{t("receive.newReceiveAddress")}</AdaptiveText>
              )}
            </Pressable>
          </>
        ) : (
          <Pressable
            style={[styles.secondary, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => void onNewArkAddress()}
          >
            {busy ? (
              <ActivityIndicator color={colors.fg} />
            ) : (
              <AdaptiveText style={styles.secondaryText} baseFontSize={14}>{t("receive.newReceiveAddress")}</AdaptiveText>
            )}
          </Pressable>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </ScreenChrome>
  );

  const overlayOpen = fiatMode ? classicOpen : posOpen;
  const edgeLabel = fiatMode ? "Open classic Receive" : "Open POS";

  return (
    <View style={styles.flexRoot} collapsable={false}>
      <GestureDetector gesture={receiveOpenGesture}>
        <View style={styles.flexRoot} collapsable={false}>
          {fiatMode ? (
            <ReceivePosPanel
              bip21Uri={bip21Uri}
              onClose={() => navigation.navigate("Home")}
              onRequestUri={buildPosBip21}
              onRequestBrlUri={buildPosBrlUri}
              fiatMode
              active={!classicOpen}
            />
          ) : (
            classicBody
          )}

          <Pressable
            style={styles.posEdgeHit}
            onPress={openOverlay}
            hitSlop={8}
            accessibilityLabel={edgeLabel}
          >
            <View style={styles.posEdgeLine} />
          </Pressable>
        </View>
      </GestureDetector>

      <Animated.View
        style={[styles.posSheet, overlayStyle]}
        pointerEvents={overlayOpen ? "auto" : "none"}
      >
        <GestureDetector gesture={overlayClosePan}>
          <View
            style={styles.posCloseEdge}
            accessibilityLabel={fiatMode ? "Close classic Receive" : "Close POS"}
          >
            <View style={styles.posEdgeLine} />
          </View>
        </GestureDetector>
        <View style={styles.posBody} collapsable={false}>
          {fiatMode ? (
            classicBody
          ) : (
            <ReceivePosPanel
              bip21Uri={bip21Uri}
              onClose={closeOverlay}
              onRequestUri={buildPosBip21}
              fiatMode={false}
              active={posOpen}
            />
          )}
        </View>
      </Animated.View>
    </View>
  );

}

const styles = StyleSheet.create({
  flexRoot: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  posEdgeHit: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 36,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 2,
  },
  posEdgeLine: {
    width: 5,
    height: 40,
    borderRadius: 2.5,
    backgroundColor: colors.border,
  },
  posSheet: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    zIndex: 10,
    elevation: 10,
  },
  posCloseEdge: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 28,
    zIndex: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  posBody: {
    flex: 1,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 8,
  },
  balance: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 28,
    color: colors.fg,
    textAlign: "center",
    marginTop: 12,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 12,
  },
  modeRow: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  modeBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  modeBtnOn: {
    borderColor: colors.fg,
  },
  modeLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
  },
  modeLabelOn: {
    color: colors.fg,
  },
  fieldLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginBottom: 6,
  },
  input: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 16,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  primary: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000000",
  },
  qrWrap: {
    alignSelf: "center",
  },
  qrPlaceholder: {
    width: 244,
    height: 244,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 4,
  },
  qrPlaceholderText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 24,
    color: "#999",
  },
  lnStatus: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 14,
  },
  pillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 28,
  },
  pill: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  pillText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.fg,
  },
  icoBtn: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    minWidth: 48,
    alignItems: "center",
  },
  icoLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.caption,
  },
  secondary: {
    marginTop: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
  boardingHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    marginTop: 20,
    paddingHorizontal: 12,
    lineHeight: 18,
  },
  errorText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: "#E07070",
    textAlign: "center",
    marginTop: 20,
    paddingHorizontal: 12,
    lineHeight: 18,
  },
});
