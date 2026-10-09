/**
 * One-shot dialog: set recovery address after Arkade balance ≥ 50k sats.
 * Tap body → Settings recovery address. X or swipe down → dismiss forever.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import type { RootStackParamList } from "./types";
import { getNetworkConfig } from "../config/network";
import { readRecoveryAddress } from "../exit/recoveryAddress";
import {
  dismissRecoveryReminder,
  shouldShowRecoveryReminder,
} from "../exit/recoveryReminder";
import { useHomeTourUiOpen } from "../home/useHomeTourUiOpen";
import { useWallet } from "../wallet/WalletProvider";
import { useSheets } from "./SheetHost";
import { colors } from "../theme/colors";

export function RecoveryAddressReminder({
  navigationRef,
}: {
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
}) {
  const insets = useSafeAreaInsets();
  const network = getNetworkConfig();
  const { hasWallet, balanceSats, selectedWallet, balanceStatus } = useWallet();
  const {
    activityOpen,
    walletOpen,
    fundsReceivedOpen,
    fundsSentOpen,
    posOpen,
    scanOpen,
    fiatModeSheetOpen,
  } = useSheets();
  const [visible, setVisible] = useState(false);
  const [routeName, setRouteName] = useState<string | undefined>();
  const translateY = useRef(new Animated.Value(0)).current;
  const homeTourOpen = useHomeTourUiOpen();

  const sheetOpen =
    activityOpen ||
    walletOpen ||
    fundsReceivedOpen ||
    fundsSentOpen ||
    posOpen ||
    scanOpen ||
    fiatModeSheetOpen;

  const refresh = useCallback(() => {
    void (async () => {
      if (!hasWallet || selectedWallet?.kind !== "arkade") {
        setVisible(false);
        return;
      }
      if (balanceStatus === "loading" && balanceSats === null) {
        setVisible(false);
        return;
      }
      const addr = await readRecoveryAddress(network.id);
      const show = await shouldShowRecoveryReminder({
        balanceSats,
        hasRecoveryAddress: !!addr,
      });
      setVisible(show);
      if (show) translateY.setValue(0);
    })();
  }, [
    hasWallet,
    selectedWallet?.kind,
    balanceSats,
    balanceStatus,
    network.id,
    translateY,
  ]);

  useEffect(() => {
    refresh();
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

  const onDismiss = useCallback(() => {
    void (async () => {
      await dismissRecoveryReminder();
      setVisible(false);
    })();
  }, []);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 8 && g.dy > 0,
      onPanResponderMove: (_e, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 64 || g.vy > 0.8) {
          Animated.timing(translateY, {
            toValue: 280,
            duration: 160,
            useNativeDriver: true,
          }).start(() => onDismiss());
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  const hidden =
    sheetOpen ||
    homeTourOpen ||
    !visible ||
    !hasWallet ||
    routeName !== "Home" ||
    selectedWallet?.kind !== "arkade";

  if (hidden) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
    >
      <Animated.View
        style={[styles.dialog, { transform: [{ translateY }] }]}
        {...pan.panHandlers}
      >
        <Pressable
          style={styles.closeHit}
          onPress={onDismiss}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Dismiss recovery address reminder"
        >
          <Text style={styles.closeX}>×</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (!navigationRef.isReady()) return;
            navigationRef.navigate("ExitRecoveryAddress", { from: "reminder" });
          }}
          accessibilityRole="button"
          accessibilityLabel="Set recovery address"
        >
          <Text style={styles.title}>Set a recovery address</Text>
          <Text style={styles.body}>
            Your Arkade balance is over 50,000 sats. Add an onchain address from an
            external wallet so Basic can prepare a unilateral exit package for you.
          </Text>
          <Text style={styles.cta}>Tap to open Settings</Text>
        </Pressable>
      </Animated.View>
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
    zIndex: 55,
  },
  dialog: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.fg,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  closeHit: {
    position: "absolute",
    top: 6,
    right: 8,
    zIndex: 2,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  closeX: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 22,
    color: colors.hint,
    lineHeight: 24,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 14,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 6,
    paddingRight: 24,
  },
  body: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 17,
  },
  cta: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 11,
    color: colors.hint,
    textAlign: "center",
    marginTop: 10,
  },
});
