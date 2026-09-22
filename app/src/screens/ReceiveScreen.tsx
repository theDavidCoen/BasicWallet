import * as Clipboard from "expo-clipboard";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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
import { useWallet } from "../wallet/WalletProvider";
import { formatSatsLabel } from "../wallet/formatSats";
import { colors } from "../theme/colors";
import { ReceivePosPanel } from "./ReceivePosPanel";

type ReceiveMode = "bip21" | "arkade" | "boarding";

function midEllipsis(s: string, left = 16, right = 6): string {
  if (s.length <= left + right + 1) return s;
  return `${s.slice(0, left)}…${s.slice(-right)}`;
}

export function ReceiveScreen() {
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
    bumpActivity,
    setPosUiHold,
  } = useWallet();
  const network = getNetworkConfig();
  const [mode, setMode] = useState<ReceiveMode>("bip21");
  const [busy, setBusy] = useState(false);
  const [boardingLoading, setBoardingLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [posOpen, setPosOpen] = useState(false);

  useEffect(() => {
    if (!posOpen) return;
    setPosUiHold(true);
    return () => setPosUiHold(false);
  }, [posOpen, setPosUiHold]);

  const windowW = Dimensions.get("window").width;
  const posX = useSharedValue(windowW);
  const posDragStart = useSharedValue(windowW);
  const posDir = useSharedValue(0);
  const posOpenSV = useSharedValue(0);

  const openPos = useCallback(() => {
    posOpenSV.value = 1;
    setPosOpen(true);
    cancelAnimation(posX);
    posX.value = withSpring(0, SHEET_SPRING);
  }, [posOpenSV, posX]);

  const closePos = useCallback(() => {
    cancelAnimation(posX);
    posX.value = withSpring(windowW, SHEET_SPRING, (finished) => {
      if (finished) {
        posOpenSV.value = 0;
        runOnJS(setPosOpen)(false);
      }
    });
  }, [posOpenSV, posX, windowW]);

  const beginPosDrag = useCallback(() => {
    posOpenSV.value = 1;
    setPosOpen(true);
  }, [posOpenSV]);

  const finishPosDismiss = useCallback(() => {
    posOpenSV.value = 0;
    setPosOpen(false);
  }, [posOpenSV]);

  const isLightning = selectedWallet?.kind === "lightning";

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
    void loadBoarding();
  }, [
    isLightning,
    needsBoarding,
    boardingAddress,
    boardingLoading,
    boardingError,
    loadBoarding,
  ]);

  // Official uses Esplora watchAddresses for boarding; RN cannot safely.
  // BIP21 / Boarding focused: cheap getBalance poll (stop on leave).
  useEffect(() => {
    if (isLightning || !needsBoarding) return;
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 15_000);
    return () => clearInterval(id);
  }, [isLightning, needsBoarding, refresh]);

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

  const buildPosBip21 = useCallback(
    (amountSats: number) =>
      encodeReceiveBip21(boardingAddress, arkAddress, null, amountSats),
    [boardingAddress, arkAddress],
  );

  const posSwipe = useMemo(() => {
    if (isLightning) return Gesture.Pan().enabled(false);
    return Gesture.Pan()
      .activeOffsetX([-16, 16])
      .failOffsetY([-32, 32])
      .onBegin(() => {
        "worklet";
        posDir.value = 0;
      })
      .onUpdate((e) => {
        "worklet";
        const dx = e.translationX;
        if (posDir.value === 0) {
          if (posOpenSV.value === 0 && dx < -10) {
            posDir.value = -1;
            cancelAnimation(posX);
            posX.value = windowW;
            posDragStart.value = windowW;
            runOnJS(beginPosDrag)();
          } else if (posOpenSV.value === 1 && dx > 10) {
            posDir.value = 1;
            cancelAnimation(posX);
            posDragStart.value = posX.value;
          }
        }
        if (posDir.value === -1) {
          const next = windowW + dx;
          posX.value = Math.min(windowW, Math.max(0, next));
        } else if (posDir.value === 1) {
          const next = posDragStart.value + dx;
          posX.value = Math.min(windowW, Math.max(0, next));
        }
      })
      .onEnd((e) => {
        "worklet";
        const dir = posDir.value;
        posDir.value = 0;
        if (dir === -1) {
          const open = posX.value < windowW * 0.55 || e.velocityX < -600;
          if (open) {
            posX.value = withSpring(0, SHEET_SPRING);
            runOnJS(beginPosDrag)();
          } else {
            posX.value = withSpring(windowW, SHEET_SPRING, (finished) => {
              if (finished) runOnJS(finishPosDismiss)();
            });
          }
          return;
        }
        if (dir === 1) {
          const close = posX.value > windowW * 0.35 || e.velocityX > 600;
          if (close) {
            posX.value = withSpring(windowW, SHEET_SPRING, (finished) => {
              if (finished) runOnJS(finishPosDismiss)();
            });
          } else {
            posX.value = withSpring(0, SHEET_SPRING);
          }
        }
      });
  }, [
    beginPosDrag,
    finishPosDismiss,
    isLightning,
    posDir,
    posDragStart,
    posOpenSV,
    posX,
    windowW,
  ]);

  const posStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posX.value }],
  }));

  const displayPayload =
    mode === "bip21" ? bip21Uri : mode === "arkade" ? arkAddress : boardingAddress;

  const bal = formatSatsLabel(balanceSats, balanceHidden);
  const boardingSats = balance?.boarding ?? 0;
  const boardingLabel = balanceHidden
    ? "******"
    : boardingSats.toLocaleString("en-US");

  const caption =
    mode === "bip21"
      ? `BIP21 · boarding + Arkade · ${network.label}`
      : mode === "arkade"
        ? `Arkade · ${network.label}`
        : `Onchain boarding · ${network.label}`;

  const qrReady =
    mode === "bip21"
      ? Boolean(bip21Uri && (boardingAddress || arkAddress))
      : Boolean(displayPayload);

  const showBoardingSpinner =
    (mode === "boarding" || mode === "bip21") && boardingLoading && !boardingAddress;

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
          <Text style={styles.title}>RECEIVE</Text>
          <Pressable onPress={toggleBalanceHidden}>
            <Text style={styles.balance}>{bal}</Text>
          </Pressable>
          <Text style={styles.caption}>
            Lightning · {selectedWallet?.label ?? "node"}
          </Text>

          {!lnInvoice ? (
            <>
              <Text style={styles.fieldLabel}>Amount (sats)</Text>
              <TextInput
                value={lnAmount}
                onChangeText={setLnAmount}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.hint}
                style={styles.input}
              />
              <Text style={styles.fieldLabel}>Memo (optional)</Text>
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
                  <Text style={styles.primaryText}>Create invoice</Text>
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
                  <Text style={styles.icoLabel}>Share</Text>
                </Pressable>
              </View>
              <Pressable style={styles.secondary} onPress={onNewLnInvoice}>
                <Text style={styles.secondaryText}>New invoice</Text>
              </Pressable>
            </>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </ScreenChrome>
    );
  }

  return (
    <GestureDetector gesture={posSwipe}>
      <View style={styles.flexRoot} collapsable={false}>
        <ScreenChrome logoScale={0.77}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.title}>RECEIVE</Text>
            <Pressable onPress={toggleBalanceHidden} onLongPress={() => void refresh()}>
              <Text style={styles.balance}>{bal}</Text>
            </Pressable>
            <Text style={styles.caption}>{caption}</Text>

            <View style={styles.modeRow}>
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
            </View>

            <View style={styles.qrWrap}>
              {qrReady && displayPayload ? (
                <ExpandableQrCode value={displayPayload} size={220} />
              ) : (
                <View style={styles.qrPlaceholder}>
                  {showBoardingSpinner ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={styles.qrPlaceholderText}>…</Text>
                  )}
                </View>
              )}
            </View>

            <View style={styles.pillRow}>
              <View style={styles.pill}>
                <Text style={styles.pillText} numberOfLines={1}>
                  {displayPayload
                    ? midEllipsis(displayPayload, mode === "bip21" ? 18 : 14, 8)
                    : showBoardingSpinner
                      ? "loading…"
                      : "…"}
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
                <Text style={styles.icoLabel}>Share</Text>
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
                <Text style={styles.secondaryText}>New receive address</Text>
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
                <Text style={styles.secondaryText}>New receive address</Text>
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
              <Text style={styles.secondaryText}>New receive address</Text>
            )}
          </Pressable>
        )}

        <View style={{ height: 24 }} />
          </ScrollView>
        </ScreenChrome>

        {/* POS swipe affordance — vertical handle on right edge (like activity). */}
        <Pressable
          style={styles.posEdgeHit}
          onPress={openPos}
          hitSlop={8}
          accessibilityLabel="Open POS"
        >
          <View style={styles.posEdgeLine} />
        </Pressable>

        <Animated.View
          style={[styles.posSheet, posStyle]}
          pointerEvents={posOpen ? "auto" : "none"}
        >
          <ReceivePosPanel
            bip21Uri={bip21Uri}
            onClose={closePos}
            onRequestUri={buildPosBip21}
            active={posOpen}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  flexRoot: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  posEdgeHit: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 28,
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
    zIndex: 10,
    elevation: 10,
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
