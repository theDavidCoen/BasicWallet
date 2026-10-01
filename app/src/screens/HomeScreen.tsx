import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  cancelAnimation,
  runOnJS,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { RestArkProvider } from "@arkade-os/sdk";
import type { RootNav } from "../navigation/types";
import { ScreenChrome, WalletAvatar } from "../components/ScreenChrome";
import { SyncProgressBar } from "../components/SyncProgressBar";
import { getVmempoolBase } from "../config/explorers";
import { getNetworkConfig } from "../config/network";
import { useExitJobs } from "../exit/ExitJobsProvider";
import { readRecoveryAddress } from "../exit/recoveryAddress";
import { syncRecoveryExitActivities } from "../exit/runExit";
import { useSheets } from "../navigation/SheetHost";
import {
  pickSnapOrDismiss,
  pickSnapOrDismissX,
  SHEET_SPRING,
} from "../components/sheet/sheetMotion";
import {
  fetchSpotRates,
  formatBtcRateFooter,
  formatHomeFiatAmount,
  formatHomeFiatLine,
  readDisplayCurrencies,
  SPOT_RATE_TTL_MS,
  type DisplayCurrencyCode,
} from "../settings/displayCurrencies";
import { useWallet } from "../wallet/WalletProvider";
import { formatSatsAmount, formatSatsLabel } from "../wallet/formatSats";
import { colors } from "../theme/colors";
import { useFiatMode } from "../fiat/FiatModeProvider";
import { formatBrlDisplay, stripFiatModeLabelSuffix } from "../fiat/depixAssets";

const MUTINYNET_OK = "#7DCEA0";
const MUTINYNET_DOWN = "#E07070";
const ASP_PROBE_MS = 8_000;
const ASP_POLL_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export function HomeScreen() {
  const navigation = useNavigation<RootNav>();
  const {
    balanceSats,
    balance,
    balanceStatus,
    balanceHidden,
    toggleBalanceHidden,
    selectedWallet,
    avatarLabel,
    bumpActivity,
  } = useWallet();
  const {
    fiatMode,
    depixDisplay,
    satsEstimate,
    pendingExitSats,
    pendingEnterFiat,
  } = useFiatMode();
  const { activeCount, pendingSweep, refreshPendingSweep } = useExitJobs();
  const {
    openActivity,
    openWalletSwitcher,
    openFiatModeEnter,
    openFiatModeExit,
    fiatModeSheetOpen,
    beginActivityDrag,
    beginPosDrag,
    beginScanDrag,
    settlePosOpen,
    settleScanOpen,
    dismissActivity,
    dismissPosSheet,
    dismissScanSheet,
    setActivityAnchorY,
    activityOpen,
    posOpen,
    scanOpen,
    posSkipEnter,
    scanSkipEnter,
    activityMotion,
    posMotion,
    scanMotion,
    setHomeDragging,
  } = useSheets();
  const network = getNetworkConfig();
  const [homeDragging, setHomeDraggingLocal] = useState(false);
  const [mutinynetOnline, setMutinynetOnline] = useState(true);
  const [fiatCodes, setFiatCodes] = useState<DisplayCurrencyCode[]>(["EUR", "USD"]);
  const [fiatRates, setFiatRates] = useState<
    Partial<Record<DisplayCurrencyCode, number>>
  >({});
  /** Home primary unit: sats or one of the enabled display fiats. */
  const [balanceUnit, setBalanceUnit] = useState<"sats" | DisplayCurrencyCode>("sats");
  const handleRef = useRef<View>(null);
  /** 0 undecided · 1 POS (LTR) · -1 scan (RTL) */
  const sideDir = useSharedValue(0);
  /** 1 = Activity/POS/Scan open or Activity dragging — block competing Home pans. */
  const sidesLocked = useSharedValue(activityOpen || posOpen || scanOpen ? 1 : 0);

  useEffect(() => {
    sidesLocked.value =
      activityOpen || homeDragging || posOpen || scanOpen ? 1 : 0;
  }, [activityOpen, homeDragging, posOpen, scanOpen, sidesLocked]);

  const openSettings = useCallback(() => {
    navigation.navigate("Settings");
  }, [navigation]);

  const openMutinynetExplorer = useCallback(() => {
    void Linking.openURL(getVmempoolBase("mutinynet"));
  }, []);

  const bal = formatSatsLabel(
    balanceSats,
    balanceHidden,
    balanceStatus === "loading" ? "…" : "0 sats",
  );

  const unitCycle = useMemo((): Array<"sats" | DisplayCurrencyCode> => {
    return ["sats", ...fiatCodes];
  }, [fiatCodes]);

  useEffect(() => {
    if (balanceUnit === "sats") return;
    if (!fiatCodes.includes(balanceUnit)) setBalanceUnit("sats");
  }, [balanceUnit, fiatCodes]);

  const cycleBalanceUnit = useCallback(() => {
    if (fiatMode) return;
    setBalanceUnit((prev) => {
      const i = unitCycle.indexOf(prev);
      const next = unitCycle[(i < 0 ? 0 : i + 1) % unitCycle.length];
      return next ?? "sats";
    });
  }, [unitCycle, fiatMode]);

  const primaryBalance = useMemo(() => {
    if (fiatMode) {
      const pending =
        pendingEnterFiat != null && pendingEnterFiat >= 0.01
          ? pendingEnterFiat
          : null;
      // Prefer pending while live is missing or still zero after Enter.
      if (pending != null && (depixDisplay == null || !(depixDisplay >= 0.01))) {
        const amt = formatBrlDisplay(pending, {
          hidden: balanceHidden,
          networkId: network.id,
        });
        return balanceHidden ? amt : `+ ${amt} pending`;
      }
      if (depixDisplay == null || !(depixDisplay >= 0.01)) {
        return "…";
      }
      return formatBrlDisplay(depixDisplay, { hidden: balanceHidden, networkId: network.id });
    }
    if (balanceUnit === "sats") return bal;
    if (balanceSats === null) {
      return balanceStatus === "loading" ? "…" : `0 ${balanceUnit}`;
    }
    return (
      formatHomeFiatAmount(balanceSats, balanceUnit, fiatRates, {
        hidden: balanceHidden,
      }) ?? (balanceHidden ? `****** ${balanceUnit}` : `… ${balanceUnit}`)
    );
  }, [
    fiatMode,
    depixDisplay,
    pendingEnterFiat,
    bal,
    balanceHidden,
    balanceSats,
    balanceStatus,
    balanceUnit,
    fiatRates,
    network.id,
  ]);

  const secondaryBalance = useMemo(() => {
    if (balanceHidden) return null;
    if (fiatMode) {
      // Sats-equivalent of DePix/BRL, not leftover carrier dust on the VTXO.
      if (satsEstimate == null) return null;
      return `≈ ${formatSatsAmount(satsEstimate, false)} sats`;
    }
    if (balanceSats === null) return null;
    if (balanceUnit === "sats") {
      return formatHomeFiatLine(balanceSats, fiatCodes, fiatRates);
    }
    return `≈ ${formatSatsAmount(balanceSats, false)} sats`;
  }, [balanceHidden, balanceSats, balanceUnit, fiatCodes, fiatRates, fiatMode, satsEstimate]);

  const mutinynetColor = mutinynetOnline ? MUTINYNET_OK : MUTINYNET_DOWN;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        await refreshPendingSweep();
        if (cancelled || !selectedWallet || selectedWallet.kind !== "arkade") {
          return;
        }
        const rec = await readRecoveryAddress(network.id);
        if (!rec || cancelled) return;
        const added = await syncRecoveryExitActivities({
          networkId: network.id,
          walletId: selectedWallet.id,
          sweepAddress: rec,
        });
        if (!cancelled && added > 0) bumpActivity();
      })();
      return () => {
        cancelled = true;
      };
    }, [
      refreshPendingSweep,
      selectedWallet,
      network.id,
      bumpActivity,
    ]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        await refreshPendingSweep();
        if (cancelled || !selectedWallet || selectedWallet.kind !== "arkade") {
          return;
        }
        const rec = await readRecoveryAddress(network.id);
        if (!rec || cancelled) return;
        const added = await syncRecoveryExitActivities({
          networkId: network.id,
          walletId: selectedWallet.id,
          sweepAddress: rec,
        });
        if (!cancelled && added > 0) bumpActivity();
      })();
      return () => {
        cancelled = true;
      };
    }, [
      refreshPendingSweep,
      selectedWallet,
      network.id,
      bumpActivity,
    ]),
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let timer: ReturnType<typeof setInterval> | null = null;

      const pull = async (codes: DisplayCurrencyCode[]) => {
        if (codes.length === 0 || cancelled) return;
        const rates = await fetchSpotRates(codes);
        if (!cancelled && Object.keys(rates).length > 0) setFiatRates(rates);
      };

      void (async () => {
        const s = await readDisplayCurrencies();
        if (cancelled) return;
        setFiatCodes(s.enabled);
        await pull(s.enabled);
        if (cancelled) return;
        timer = setInterval(() => {
          void pull(s.enabled);
        }, SPOT_RATE_TTL_MS);
      })();

      return () => {
        cancelled = true;
        if (timer) clearInterval(timer);
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      if (network.id !== "mutinynet") return;

      let cancelled = false;
      let inFlight = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      const url = network.arkServerUrl;

      const probe = async () => {
        if (cancelled || inFlight) return;
        inFlight = true;
        try {
          const provider = new RestArkProvider(url);
          await withTimeout(provider.getInfo(), ASP_PROBE_MS, "getInfo");
          if (!cancelled) setMutinynetOnline(true);
        } catch {
          if (!cancelled) setMutinynetOnline(false);
        } finally {
          inFlight = false;
        }
      };

      void probe();
      timer = setInterval(() => {
        void probe();
      }, ASP_POLL_MS);

      return () => {
        cancelled = true;
        if (timer) clearInterval(timer);
      };
    }, [network.id, network.arkServerUrl]),
  );

  /** Android root: first back shows toast; second within 2s exits. Sheets own back when open. */
  useFocusEffect(
    useCallback(() => {
      let lastBackAt = 0;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (navigation.canGoBack()) return false;
        const now = Date.now();
        if (now - lastBackAt < 2_000) {
          lastBackAt = 0;
          return false;
        }
        lastBackAt = now;
        if (Platform.OS === "android") {
          ToastAndroid.show("Tap again to exit the app", ToastAndroid.SHORT);
        }
        return true;
      });
      return () => sub.remove();
    }, [navigation]),
  );

  const rateFooter = useMemo(() => {
    return formatBtcRateFooter(fiatCodes, fiatRates);
  }, [fiatCodes, fiatRates]);

  const measureHandle = useCallback(() => {
    handleRef.current?.measureInWindow((_x, y) => {
      if (typeof y === "number" && y > 0) {
        setActivityAnchorY(y);
      }
    });
  }, [setActivityAnchorY]);

  const onHandleLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      requestAnimationFrame(measureHandle);
    },
    [measureHandle],
  );

  const onDragStartJS = useCallback(() => {
    measureHandle();
    setHomeDraggingLocal(true);
    setHomeDragging(true);
    beginActivityDrag();
  }, [beginActivityDrag, measureHandle, setHomeDragging]);

  const clearHomeDragJS = useCallback(() => {
    setHomeDraggingLocal(false);
    setHomeDragging(false);
  }, [setHomeDragging]);

  const finishDismissJS = useCallback(() => {
    clearHomeDragJS();
    dismissActivity();
  }, [clearHomeDragJS, dismissActivity]);

  const finishPosDismissJS = useCallback(() => {
    dismissPosSheet();
  }, [dismissPosSheet]);

  const finishScanDismissJS = useCallback(() => {
    dismissScanSheet();
  }, [dismissScanSheet]);

  const {
    translateY,
    openY,
    revealY,
    offY,
    windowH,
    dragStartY,
  } = activityMotion;
  const {
    translateX: posX,
    openX: posOpenX,
    offX: posOffX,
    windowW: posW,
    dragStartX: posDragStart,
  } = posMotion;
  const {
    translateX: scanX,
    openX: scanOpenX,
    offX: scanOffX,
    windowW: scanW,
    dragStartX: scanDragStart,
  } = scanMotion;

  const { pan, homeSwipe } = useMemo(() => {
    const activityPan = Gesture.Pan()
      .activeOffsetY([-4, 4])
      .failOffsetX([-40, 40])
      .onBegin(() => {
        "worklet";
        // Lock sides immediately — before JS sets activityOpen (prevents POS/Scan flash).
        sidesLocked.value = 1;
        cancelAnimation(translateY);
        const start = revealY.value > 0 ? revealY.value : offY.value;
        translateY.value = start;
        dragStartY.value = start;
        runOnJS(onDragStartJS)();
      })
      .onUpdate((e) => {
        "worklet";
        const next = dragStartY.value + e.translationY;
        translateY.value = Math.max(openY.value, Math.min(dragStartY.value, next));
      })
      .onEnd((e) => {
        "worklet";
        const decision = pickSnapOrDismiss(
          windowH.value,
          revealY.value,
          translateY.value,
          e.velocityY,
          openY.value,
        );
        if (decision === -1) {
          sidesLocked.value = 0;
          translateY.value = withSpring(offY.value, SHEET_SPRING, (finished) => {
            if (finished) runOnJS(finishDismissJS)();
          });
          runOnJS(clearHomeDragJS)();
          return;
        }
        // Stay locked while Activity sheet is open.
        sidesLocked.value = 1;
        translateY.value = withSpring(openY.value, SHEET_SPRING);
        runOnJS(clearHomeDragJS)();
      });

    /**
     * Interactive side pages: LTR → POS, RTL → Scan (follow finger like Activity).
     * Keep `.enabled` true while POS/Scan React state flips mid-drag — otherwise
     * RNGH cancels the active pan the instant beginPosDrag sets posOpen, and the
     * sheet freezes half-open. Gate new starts with sidesLocked / sheet position.
     */
    /**
     * Settled side sheets: disable Home swipe entirely (Xiaomi still delivered
     * pans under pointerEvents=none and could peek Scan while POS was open).
     * Mid-open drag keeps skipEnter true so this gesture stays enabled.
     */
    const sidesSettled =
      (posOpen && !posSkipEnter) || (scanOpen && !scanSkipEnter);
    const swipe = Gesture.Pan()
      .enabled(!activityOpen && !sidesSettled)
      .activeOffsetX([-12, 12])
      .failOffsetY([-56, 56])
      .onBegin(() => {
        "worklet";
        if (sidesLocked.value) return;
        if (Math.abs(posX.value - posOpenX.value) < 48) return;
        if (Math.abs(scanX.value - scanOpenX.value) < 48) return;
        // Either sheet already off its resting offscreen seat — do not start.
        if (Math.abs(posX.value - posOffX.value) > 8) return;
        if (Math.abs(scanX.value - scanOffX.value) > 8) return;
        sideDir.value = 0;
      })
      .onUpdate((e) => {
        "worklet";
        // In-progress POS/Scan drag continues even after we lock sides.
        if (sideDir.value === 0) {
          if (sidesLocked.value) return;
          if (Math.abs(posX.value - posOpenX.value) < 48) return;
          if (Math.abs(scanX.value - scanOpenX.value) < 48) return;
          if (Math.abs(posX.value - posOffX.value) > 8) return;
          if (Math.abs(scanX.value - scanOffX.value) > 8) return;
          const dx = e.translationX;
          if (dx > 8) {
            sideDir.value = 1;
            // Lock immediately so a reverse swipe cannot start Scan mid-open.
            sidesLocked.value = 1;
            cancelAnimation(posX);
            posX.value = posOffX.value;
            posDragStart.value = posOffX.value;
            runOnJS(beginPosDrag)();
          } else if (dx < -8) {
            sideDir.value = -1;
            sidesLocked.value = 1;
            cancelAnimation(scanX);
            scanX.value = scanOffX.value;
            scanDragStart.value = scanOffX.value;
            runOnJS(beginScanDrag)();
          } else {
            return;
          }
        }
        if (sideDir.value === 1) {
          const next = posOffX.value + e.translationX;
          posX.value = Math.max(posOffX.value, Math.min(posOpenX.value, next));
        } else if (sideDir.value === -1) {
          const next = scanOffX.value + e.translationX;
          scanX.value = Math.min(scanOffX.value, Math.max(scanOpenX.value, next));
        }
      })
      .onEnd((e) => {
        "worklet";
        const dir = sideDir.value;
        sideDir.value = 0;
        if (dir === 0) return;
        if (dir === 1) {
          const decision = pickSnapOrDismissX(
            posW.value,
            posX.value,
            e.velocityX,
            "left",
          );
          if (decision === -1) {
            sidesLocked.value = 0;
            posX.value = withSpring(posOffX.value, SHEET_SPRING, (finished) => {
              if (finished) runOnJS(finishPosDismissJS)();
            });
            return;
          }
          // Stay locked while POS is open.
          sidesLocked.value = 1;
          posX.value = withSpring(posOpenX.value, SHEET_SPRING, (finished) => {
            if (finished) runOnJS(settlePosOpen)();
          });
          return;
        }
        if (dir === -1) {
          const decision = pickSnapOrDismissX(
            scanW.value,
            scanX.value,
            e.velocityX,
            "right",
          );
          if (decision === -1) {
            sidesLocked.value = 0;
            scanX.value = withSpring(scanOffX.value, SHEET_SPRING, (finished) => {
              if (finished) runOnJS(finishScanDismissJS)();
            });
            return;
          }
          sidesLocked.value = 1;
          scanX.value = withSpring(scanOpenX.value, SHEET_SPRING, (finished) => {
            if (finished) runOnJS(settleScanOpen)();
          });
        }
      });

    return { pan: activityPan, homeSwipe: swipe };
  }, [
    activityOpen,
    beginPosDrag,
    beginScanDrag,
    clearHomeDragJS,
    dragStartY,
    finishDismissJS,
    finishPosDismissJS,
    finishScanDismissJS,
    settlePosOpen,
    settleScanOpen,
    offY,
    onDragStartJS,
    openY,
    posDragStart,
    posOffX,
    posOpen,
    posOpenX,
    posSkipEnter,
    posW,
    posX,
    revealY,
    scanDragStart,
    scanOffX,
    scanOpen,
    scanOpenX,
    scanSkipEnter,
    scanW,
    scanX,
    sideDir,
    sidesLocked,
    translateY,
    windowH,
  ]);

  const statusHint = (() => {
    if (balanceHidden) return null;
    if (balanceStatus === "loading") {
      return balanceSats !== null ? "syncing…" : "opening wallet…";
    }
    if (balanceStatus === "error") return "sync failed · retrying…";
    if (balance && balance.boarding > 0) {
      return `boarding ${formatSatsAmount(balance.boarding, false)} · available ${formatSatsAmount(balance.available, false)}`;
    }
    if (balance && balance.available > 0 && balance.available !== balance.total) {
      return `available ${formatSatsAmount(balance.available, false)}`;
    }
    return null;
  })();

  return (
    <GestureDetector gesture={homeSwipe}>
      <View style={styles.full} collapsable={false}>
        <SyncProgressBar active={balanceStatus === "loading"} />
        <ScreenChrome
          logoScale={1}
          avatar={
            <WalletAvatar label={avatarLabel} onPress={openWalletSwitcher} />
          }
          headerRight={
            <View style={styles.headerRightStack}>
              {selectedWallet?.kind === "arkade" ? (
                <Pressable
                  // InteractiveBottomSheet via SheetHost (same pattern as Wallets).
                  onPress={fiatMode ? openFiatModeExit : openFiatModeEnter}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={fiatMode ? "Exit Fiat Mode" : "Enter Fiat Mode"}
                  style={styles.fiatModeBtn}
                >
                  <Text style={styles.fiatModeBtnLabel}>{fiatMode ? "₿" : "R$"}</Text>
                </Pressable>
              ) : null}
              {activeCount > 0 ? (
                <Pressable
                  onPress={() => navigation.navigate("UnilateralExitHub")}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Unilateral exit in progress"
                  style={styles.exitBadgeRow}
                >
                  <View style={styles.exitDot} />
                  <Text style={styles.exitBadge}>
                    {activeCount === 1 ? "exit in progress" : `${activeCount} exits`}
                  </Text>
                </Pressable>
              ) : pendingSweep.count > 0 ? (
                <Pressable
                  onPress={() => navigation.navigate("UnilateralExitHub")}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Exit remaining funds onchain"
                  style={styles.exitBadgeRow}
                >
                  <View style={styles.exitDot} />
                  <Text style={styles.exitBadge}>
                    {`exit remaining · ${pendingSweep.sats.toLocaleString("en-US")}`}
                  </Text>
                </Pressable>
              ) : null}
              {network.id === "mutinynet" ? (
                <Pressable
                  onPress={openMutinynetExplorer}
                  hitSlop={8}
                  accessibilityRole="link"
                  accessibilityLabel={
                    mutinynetOnline
                      ? "Mutinynet online, open explorer"
                      : "Mutinynet offline, open explorer"
                  }
                  style={styles.mutinynetBadgeRow}
                >
                  <View
                    style={[styles.mutinynetDot, { backgroundColor: mutinynetColor }]}
                  />
                  <Text style={[styles.mutinynetBadge, { color: mutinynetColor }]}>
                    mutinynet
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
          onLongPressEmpty={openSettings}
        >
          <View style={styles.flex}>
            <View style={styles.center}>
              <View style={styles.walletTagRow}>
                <Text style={styles.walletTag}>
                  {stripFiatModeLabelSuffix(selectedWallet?.label ?? "Personal")}
                </Text>
                {fiatMode ? (
                  <View style={styles.fiatModeBadge} accessibilityLabel="Fiat Mode on">
                    <Text style={styles.fiatModeBadgeLabel}>FIAT MODE</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.balanceRow}>
                <Pressable onPress={toggleBalanceHidden} style={styles.balancePress}>
                  <Text
                    style={styles.balance}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.45}
                  >
                    {primaryBalance}
                  </Text>
                </Pressable>
                {!fiatMode ? (
                  <Pressable
                    onPress={cycleBalanceUnit}
                    style={styles.swapBtn}
                    hitSlop={12}
                    accessibilityLabel="Switch balance unit"
                  >
                    <Text style={styles.swapIco}>⇅</Text>
                  </Pressable>
                ) : null}
              </View>
              {secondaryBalance ? (
                <Text style={styles.fiatHint}>{secondaryBalance}</Text>
              ) : null}
              {!fiatMode && pendingExitSats != null && pendingExitSats > 0 ? (
                <Text
                  style={styles.pendingExitHint}
                  accessibilityLabel={`${pendingExitSats} sats pending`}
                >
                  {`+ ${pendingExitSats.toLocaleString("en-US")} sats pending`}
                </Text>
              ) : null}
              {statusHint ? <Text style={styles.statusHint}>{statusHint}</Text> : null}

              <View style={styles.actions}>
                <Pressable
                  style={styles.ghostBtn}
                  onPressIn={() => navigation.navigate("Receive")}
                >
                  <Text style={styles.ghostLabel}>Receive</Text>
                </Pressable>
                <Pressable
                  style={styles.ghostBtn}
                  onPressIn={() => navigation.navigate("Send")}
                >
                  <Text style={styles.ghostLabel}>Send</Text>
                </Pressable>
              </View>
            </View>

            <Pressable
              style={styles.chatPayCard}
              onPress={() => navigation.navigate("PayHub")}
              accessibilityRole="button"
              accessibilityLabel="Chat and Pay"
            >
              <Text style={styles.chatPayTitle}>Chat & Pay</Text>
              <Text style={styles.chatPayHint}>Private chats · pay contacts</Text>
            </Pressable>

            <GestureDetector gesture={pan}>
              <View
                ref={handleRef}
                onLayout={onHandleLayout}
                style={[
                  styles.histHit,
                  (activityOpen && !homeDragging) || fiatModeSheetOpen
                    ? styles.histHitHidden
                    : null,
                ]}
                collapsable={false}
                pointerEvents={
                  (activityOpen && !homeDragging) || fiatModeSheetOpen ? "none" : "auto"
                }
              >
                <Pressable onPress={() => openActivity()} hitSlop={16}>
                  <View style={styles.histHandle} />
                </Pressable>
              </View>
            </GestureDetector>

            {rateFooter ? (
              <Pressable onPress={openSettings} hitSlop={12}>
                <Text style={styles.rateFooter}>{rateFooter}</Text>
              </Pressable>
            ) : (
              <View style={styles.rateFooterSpacer} />
            )}
          </View>
        </ScreenChrome>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  full: { flex: 1 },
  flex: { flex: 1 },
  headerRightStack: {
    alignItems: "flex-end",
    gap: 6,
    maxWidth: 140,
  },
  /** Match WalletAvatar (top-left) size/style. */
  fiatModeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.fg,
    alignItems: "center",
    justifyContent: "center",
  },
  fiatModeBtnLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
  },
  exitBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  exitDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E0A070",
  },
  exitBadge: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    color: "#E0A070",
    textAlign: "right",
    lineHeight: 14,
    flexShrink: 1,
  },
  mutinynetBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 110,
  },
  mutinynetDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  mutinynetBadge: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 10,
    textAlign: "right",
    lineHeight: 14,
    flexShrink: 1,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 48,
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    maxWidth: "100%",
    paddingHorizontal: 8,
    gap: 2,
    minHeight: 36,
  },
  balancePress: {
    flexShrink: 1,
    maxWidth: "88%",
  },
  balance: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 28,
    color: colors.fg,
    textAlign: "right",
  },
  swapBtn: {
    paddingVertical: 6,
    paddingLeft: 2,
    paddingRight: 4,
    flexShrink: 0,
  },
  swapIco: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
  },
  walletTagRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  walletTag: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.caption,
    textAlign: "center",
  },
  fiatModeBadge: {
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  fiatModeBadgeLabel: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 10,
    color: colors.fg,
    letterSpacing: 0.5,
  },
  fiatHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: "#8C8C8C",
    textAlign: "center",
    marginTop: 6,
    minHeight: 18,
  },
  pendingExitHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    marginTop: 4,
  },
  statusHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    marginTop: 4,
  },
  actions: {
    flexDirection: "row",
    gap: 16,
    marginTop: 40,
    justifyContent: "center",
  },
  ghostBtn: {
    flex: 1,
    maxWidth: 160,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    alignItems: "center",
  },
  ghostLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 16,
    color: colors.fg,
  },
  /** Same horizontal span as Receive+Send (maxWidth 160 each + gap 16). */
  chatPayCard: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 336,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 4,
  },
  chatPayTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: colors.fg,
    textAlign: "center",
  },
  chatPayHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginTop: 4,
  },
  histHit: {
    alignItems: "center",
    justifyContent: "flex-end",
    paddingTop: 20,
    paddingBottom: 12,
    marginBottom: 4,
    minHeight: 52,
  },
  histHitHidden: {
    opacity: 0,
  },
  histHandle: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.border,
    alignSelf: "center",
  },
  rateFooter: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginBottom: 8,
  },
  rateFooterSpacer: {
    height: 28,
    marginBottom: 8,
  },
});
