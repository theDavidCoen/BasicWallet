/**
 * Bluetooth fast login — Device 1 (logged-in) approves a nearby onboarding device.
 */

import { useNavigation } from "@react-navigation/native";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import {
  broadcastCipherReply,
  cancelPairBle,
  scanRequesterHello,
} from "../pair/pairBleTransport";
import {
  assemblePairLoginPackage,
  encodePairLoginPackage,
} from "../pair/pairLoginPackage";
import {
  encodeWireEnvelope,
  encryptPairPayload,
  verifyLobbyBind,
  lobbyIdFromPub,
} from "../pair/pairProtocol";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

type Phase = "idle" | "scanning" | "confirm" | "sending" | "done";

export function PairBluetoothScreen() {
  const navigation = useNavigation<RootNav>();
  const { hasWallet } = useWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void cancelPairBle();
    };
  }, []);

  async function onStart() {
    if (!hasWallet) {
      Alert.alert("No wallet", "Create or restore a wallet before pairing.");
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPhase("scanning");
    setStatus("Scanning for nearby Basic…");
    try {
      const hello = await scanRequesterHello({
        onStatus: setStatus,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;

      const lobbyId = lobbyIdFromPub(hello.pubCompressed);
      if (!verifyLobbyBind(hello.pubCompressed, lobbyId)) {
        throw new Error("Lobby id does not match the nearby key");
      }

      setPhase("confirm");
      setStatus(`Found device · ${lobbyId}`);

      const auth = await requireUserPresence(
        "Approve pairing? This unlocks your wallets on the other device.",
      );
      if (!auth.ok) {
        setPhase("idle");
        setStatus("");
        await cancelPairBle();
        return;
      }

      setPhase("sending");
      setStatus("Building encrypted login…");
      const pkg = await assemblePairLoginPackage();
      const { envelope } = encryptPairPayload(
        encodePairLoginPackage(pkg),
        hello.pubCompressed,
      );
      const wire = encodeWireEnvelope(envelope);
      await broadcastCipherReply({
        lobbyHash8: hello.lobbyHash8,
        wireBytes: wire,
        onStatus: setStatus,
        signal: ac.signal,
      });
      setPhase("done");
      setStatus("Sent. Opening Home…");
      Alert.alert("Paired", "Encrypted login sent to the nearby device.");
      navigation.navigate("Home");
    } catch (e) {
      if (ac.signal.aborted) return;
      setPhase("idle");
      setStatus("");
      Alert.alert("Pairing failed", e instanceof Error ? e.message : "Unknown error");
      await cancelPairBle();
    }
  }

  function onCancel() {
    abortRef.current?.abort();
    void cancelPairBle();
    setPhase("idle");
    setStatus("");
  }

  const busy = phase === "scanning" || phase === "sending" || phase === "confirm";

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={ui.title}>PAIR WITH BLUETOOTH</Text>
        <Text style={ui.caption}>
          Move wallets to a nearby phone that is on the Basic welcome screen.
          {"\n"}Secrets stay encrypted over Bluetooth.
        </Text>

        <View style={ui.cardMuted}>
          {[
            "Open Basic on the new device (welcome screen).",
            "Bring the phones close together.",
            "Tap Start scan here, then approve with biometrics.",
          ].map((line) => (
            <Text key={line} style={[ui.caption, { textAlign: "left", marginBottom: 10 }]}>
              · {line}
            </Text>
          ))}
        </View>

        {status ? <Text style={styles.status}>{status}</Text> : null}

        <Pressable
          style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => void onStart()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={ui.primaryBtnText}>Start scan</Text>
          )}
        </Pressable>

        {busy ? (
          <Pressable style={ui.secondaryBtn} onPress={onCancel}>
            <Text style={ui.secondaryBtnText}>Cancel</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  status: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 16,
    marginBottom: 8,
  },
});
