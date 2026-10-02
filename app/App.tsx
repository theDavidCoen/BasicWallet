import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, LogBox, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { wipePlaintextAccountDbsIfNeeded } from "./src/account/sqliteCipher";
import { failStaleOutboundPayments } from "./src/chat/chatStore";
import { registerAppRemount } from "./src/runtime/remountApp";
import { loadNetworkPreferences } from "./src/config/networkPrefs";
import { RootNavigator } from "./src/navigation/RootNavigator";
import {
  ensureAccountDbKey,
  hadLegacyMainnetCipherMigration,
  isSqlCipherMigrated,
  markSqlCipherMigrated,
} from "./src/security/accountDbKey";
import { WalletProvider } from "./src/wallet/WalletProvider";
import { ExitJobsProvider } from "./src/exit/ExitJobsProvider";
import { FiatModeProvider } from "./src/fiat/FiatModeProvider";
import { FiatModeConvertingOverlay } from "./src/fiat/FiatModeConvertingOverlay";
import { colors } from "./src/theme/colors";

// Dev banner noise — does not hide real redbox errors.
LogBox.ignoreLogs([
  "Non-serializable values were found in the navigation state",
  "SafeAreaView has been deprecated",
  "Cannot read property 'version' of undefined",
  "process.version",
  "ContractWatcher connection failed",
  "ContractWatcher poll failed",
  "Error fetching boarding UTXOs",
  "Error during deprecated-signer migration",
  "Subscription error",
  "Esplora websocket unavailable",
  "Could not baseline watched addresses",
  "Error polling watched addresses",
  "Failed to fetch chain tip",
  "Software caused connection abort",
  "software caused connection abort",
  "Connection closed",
]);

export default function App() {
  const [fontsLoaded] = useFonts({
    JetBrainsMono_400Regular: require("./assets/fonts/JetBrainsMono_400Regular.ttf"),
    JetBrainsMono_700Bold: require("./assets/fonts/JetBrainsMono_700Bold.ttf"),
  });
  const [dbKeyReady, setDbKeyReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  /** Bump to remount providers after network switch (keeps Metro session). */
  const [sessionKey, setSessionKey] = useState(0);

  useEffect(() => {
    return registerAppRemount(() => {
      setDbKeyReady(false);
      setSessionKey((k) => k + 1);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureAccountDbKey();
        await loadNetworkPreferences();
        if (sessionKey === 0) {
          const fullyMigrated = await isSqlCipherMigrated();
          const legacyMainnetOnly = !fullyMigrated && (await hadLegacyMainnetCipherMigration());
          wipePlaintextAccountDbsIfNeeded({ fullyMigrated, legacyMainnetOnly });
          if (!fullyMigrated) await markSqlCipherMigrated();
        }
        // Orphaned Converting/Sending bubbles (killed convert+send) → failed.
        // Wait past chat send soft-timeout (α69 false 90s timeout on Xiaomi).
        try {
          failStaleOutboundPayments({ olderThanMs: 4 * 60_000 });
        } catch (e) {
          console.warn("[basic] failStaleOutboundPayments boot skipped", e);
        }
        if (!cancelled) setDbKeyReady(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[basic] account DB key boot failed", e);
        if (!cancelled) setBootError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionKey]);

  if (bootError) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: colors.fg, textAlign: "center" }}>{bootError}</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  if (!fontsLoaded || !dbKeyReady) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.fg} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }} key={sessionKey}>
      <SafeAreaProvider>
        <WalletProvider>
          <FiatModeProvider>
            <ExitJobsProvider>
              <RootNavigator />
            </ExitJobsProvider>
            <FiatModeConvertingOverlay />
            <StatusBar style="light" />
          </FiatModeProvider>
        </WalletProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
