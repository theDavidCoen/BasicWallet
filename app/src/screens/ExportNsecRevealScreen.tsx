import * as Clipboard from "expo-clipboard";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as ScreenCapture from "expo-screen-capture";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { loadNostrKeyPairForCrypto } from "../nostr/identityStore";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

/** Penpot 05j — reveal nsec after biometrics; FLAG_SECURE. */
export function ExportNsecRevealScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "ExportNsecReveal">>();
  const afterEnable = route.params?.afterEnable;
  const [busy, setBusy] = useState(true);
  const [nsec, setNsec] = useState<string | null>(null);
  const nsecRef = useRef<string | null>(null);

  const clearReveal = useCallback(() => {
    nsecRef.current = null;
    setNsec(null);
    void Clipboard.setStringAsync("").catch(() => {});
    void ScreenCapture.allowScreenCaptureAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next !== "active" && nsecRef.current) clearReveal();
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => {
      sub.remove();
      clearReveal();
    };
  }, [clearReveal]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const auth = await requireUserPresence("Confirm to show your nsec");
        if (!auth.ok) {
          Alert.alert("Authentication required", "nsec was not shown.");
          navigation.goBack();
          return;
        }
        const pair = await loadNostrKeyPairForCrypto();
        if (!pair) {
          Alert.alert("No identity", "Generate or import an nsec first.");
          navigation.goBack();
          return;
        }
        try {
          await ScreenCapture.preventScreenCaptureAsync();
        } catch (e) {
          console.warn("[basic] preventScreenCapture unavailable", e);
        }
        if (cancelled) return;
        nsecRef.current = pair.nsec;
        setNsec(pair.nsec);
      } catch (e) {
        Alert.alert("Could not load nsec", e instanceof Error ? e.message : "Unknown error");
        navigation.goBack();
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  async function onCopy() {
    if (!nsec) return;
    await Clipboard.setStringAsync(nsec);
    Alert.alert("Copied", "Clipboard cleared when you leave.");
  }

  function onDone() {
    clearReveal();
    if (afterEnable === "Ready") {
      navigation.reset({ index: 0, routes: [{ name: "Ready" }] });
      return;
    }
    if (afterEnable === "AdvancedBackup") {
      navigation.navigate("AdvancedBackup");
      return;
    }
    navigation.navigate("NostrIdentity");
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={ui.title}>YOUR NSEC</Text>
        <Text style={ui.caption}>
          Write it down · then leave this screen
          {afterEnable
            ? "\n\nKeep this nsec with your backup passphrase\nto restore Nostr / home packages later."
            : ""}
        </Text>

        {busy || !nsec ? (
          <ActivityIndicator color={colors.fg} style={{ marginTop: 40 }} />
        ) : (
          <View style={styles.box}>
            <Text style={styles.nsec} selectable={false}>
              {nsec}
            </Text>
          </View>
        )}

        {nsec ? (
          <>
            <Pressable style={ui.primaryBtn} onPress={() => void onCopy()}>
              <Text style={ui.primaryBtnText}>Copy nsec</Text>
            </Pressable>
            <Pressable style={ui.secondaryBtn} onPress={onDone}>
              <Text style={ui.secondaryBtnText}>Done</Text>
            </Pressable>
          </>
        ) : null}

        <Text style={[ui.hint, { marginTop: 20 }]}>
          Clipboard cleared when you leave.
        </Text>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: 20,
    backgroundColor: "#0D0D0D",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.fg,
    padding: 16,
  },
  nsec: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 13,
    color: colors.fg,
    textAlign: "center",
    lineHeight: 20,
  },
});
