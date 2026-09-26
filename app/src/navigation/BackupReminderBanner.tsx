import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import type { RootStackParamList } from "./types";
import {
  isBackupReminderPending,
} from "../wallet/backupReminder";
import { colors } from "../theme/colors";
import { useWallet } from "../wallet/WalletProvider";
import { useSheets } from "./SheetHost";

/**
 * Bottom dialog only when onboarding backup was skipped.
 * Shown only on Home (never on other screens or while a sheet is open).
 */
export function BackupReminderBanner({
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
  const [showNoBackup, setShowNoBackup] = useState(false);
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
    void (async () => {
      if (!hasWallet) {
        setShowNoBackup(false);
        return;
      }
      setShowNoBackup(await isBackupReminderPending());
    })();
  }, [hasWallet]);

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

  const hidden =
    sheetOpen ||
    !showNoBackup ||
    !hasWallet ||
    routeName !== "Home";

  if (hidden) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
    >
      <Pressable
        style={styles.dialog}
        onPress={() => {
          if (!navigationRef.isReady()) return;
          navigationRef.navigate("AdvancedBackup");
        }}
        accessibilityRole="button"
        accessibilityLabel="No backup set up"
      >
        <Text style={styles.title}>No backup set up</Text>
        <Text style={styles.body}>
          Your wallet is only on this device. Tap to add Nostr, home server, or export your recovery
          phrase.
        </Text>
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
    zIndex: 50,
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
