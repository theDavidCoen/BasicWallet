import { useCallback, useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import type { RootStackParamList } from "./types";
import { BackupPassphraseSheet } from "../components/BackupPassphraseSheet";
import {
  needsBackupPassphraseEntry,
  onBackupPassphraseSessionChange,
} from "../nostr/backupSync";
import { isBackupReminderPending } from "../wallet/backupReminder";
import { colors } from "../theme/colors";
import { useWallet } from "../wallet/WalletProvider";
import { useSheets } from "./SheetHost";

type BannerKind = "no-backup" | "passphrase" | null;

/**
 * Bottom dialogs on Home only (never while a sheet is open):
 * - "No backup set up" — onboarding/pair skipped cloud backup
 * - "Enter your backup passphrase" — only after BLE pair sets
 *   backupPassphraseNeededAfterPair (Device 2); never merely because meta is
 *   enabled and the RAM session is empty (Device 1 / cold start must stay quiet)
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
  const [bannerKind, setBannerKind] = useState<BannerKind>(null);
  const [passphraseSheetOpen, setPassphraseSheetOpen] = useState(false);
  const [routeName, setRouteName] = useState<string | undefined>();

  const sheetOpen =
    activityOpen ||
    walletOpen ||
    fundsReceivedOpen ||
    fundsSentOpen ||
    posOpen ||
    scanOpen ||
    fiatModeSheetOpen ||
    passphraseSheetOpen;

  const refresh = useCallback(() => {
    void (async () => {
      if (!hasWallet) {
        setBannerKind(null);
        return;
      }
      // Armed meta + missing passphrase wins over "no backup set up".
      if (await needsBackupPassphraseEntry()) {
        setBannerKind("passphrase");
        return;
      }
      if (await isBackupReminderPending()) {
        setBannerKind("no-backup");
        return;
      }
      setBannerKind(null);
    })();
  }, [hasWallet]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh when session passphrase or after-pair flag changes.
  useEffect(() => {
    return onBackupPassphraseSessionChange(() => {
      refresh();
    });
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => sub.remove();
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
    bannerKind == null ||
    !hasWallet ||
    routeName !== "Home";

  return (
    <>
      {!hidden ? (
        <View
          pointerEvents="box-none"
          style={[styles.overlay, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}
        >
          {bannerKind === "passphrase" ? (
            <Pressable
              style={styles.dialog}
              onPress={() => setPassphraseSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Enter your backup passphrase"
            >
              <Text style={styles.title}>Enter your backup passphrase</Text>
              <Text style={styles.body}>
                Cloud backup is already set up. Tap to enter the passphrase so this
                device can encrypt and upload updates. It stays in memory for this
                session only.
              </Text>
            </Pressable>
          ) : (
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
                Your wallet is only on this device. Pairing does not move your passkey.
                Tap to add Nostr, home server, or export your recovery phrase.
              </Text>
            </Pressable>
          )}
        </View>
      ) : null}

      <BackupPassphraseSheet
        open={passphraseSheetOpen}
        onDismiss={() => setPassphraseSheetOpen(false)}
        onArmed={() => {
          setBannerKind(null);
          refresh();
        }}
      />
    </>
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
