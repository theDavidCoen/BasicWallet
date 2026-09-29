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
  cancelPairBle,
  ensureBlePermissions,
  scanRequesterHello,
  type ApproverBleSession,
} from "../pair/pairBleTransport";
import {
  assemblePairLoginPackage,
  encodePairLoginPackage,
} from "../pair/pairLoginPackage";
import {
  encodeWireEnvelope,
  encryptPairPayload,
  lobbyIdFromPub,
  verifyLobbyBind,
} from "../pair/pairProtocol";
import { unlockBackupPassphraseSession } from "../nostr/backupSync";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

type Phase = "idle" | "scanning" | "confirm" | "approving" | "sending" | "done";

type PendingHello = {
  session: ApproverBleSession;
  lobbyId: string;
};

export function PairBluetoothScreen() {
  const navigation = useNavigation<RootNav>();
  const { hasWallet } = useWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<PendingHello | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const approveLock = useRef(false);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void pending?.session.cancel();
      void cancelPairBle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, []);

  async function onStart() {
    if (!hasWallet) {
      Alert.alert("No wallet", "Create or restore a wallet before pairing.");
      return;
    }
    abortRef.current?.abort();
    await pending?.session.cancel().catch(() => undefined);
    const ac = new AbortController();
    abortRef.current = ac;
    approveLock.current = false;
    setPending(null);
    setPhase("scanning");
    setStatus("Requesting Bluetooth permission…");
    const permitted = await ensureBlePermissions();
    if (ac.signal.aborted) return;
    if (!permitted) {
      setPhase("idle");
      setStatus("");
      Alert.alert(
        "Bluetooth permission required",
        "Allow Bluetooth (and nearby devices) for Basic so it can scan and pair.",
      );
      return;
    }
    setStatus("Scanning for nearby Basic…");
    try {
      const session = await scanRequesterHello({
        onStatus: setStatus,
        signal: ac.signal,
      });
      if (ac.signal.aborted) {
        await session.cancel();
        return;
      }

      const lobbyId = lobbyIdFromPub(session.pubCompressed);
      if (!verifyLobbyBind(session.pubCompressed, lobbyId)) {
        await session.cancel();
        throw new Error("Lobby id does not match the nearby key");
      }

      setPending({ session, lobbyId });
      setPhase("confirm");
      setStatus("Compare this code with the new phone, then approve.");
    } catch (e) {
      if (ac.signal.aborted) return;
      setPhase("idle");
      setStatus("");
      setPending(null);
      Alert.alert("Pairing failed", e instanceof Error ? e.message : "Unknown error");
      await cancelPairBle();
    }
  }

  async function onApprove() {
    if (!pending || approveLock.current) return;
    if (phase !== "confirm") return;
    approveLock.current = true;
    setPhase("approving");
    setStatus("Confirm with biometrics…");

    const ac = abortRef.current ?? new AbortController();
    abortRef.current = ac;
    const { session, lobbyId } = pending;

    try {
      const auth = await requireUserPresence(
        `Approve pairing code ${lobbyId}? This unlocks your wallets on the other device.`,
      );
      if (!auth.ok) {
        approveLock.current = false;
        setPhase("confirm");
        setStatus("Compare this code with the new phone, then approve.");
        return;
      }

      setPhase("sending");
      setStatus("Building encrypted login…");
      // Presence may have briefly locked the RAM session; reload before packing.
      await unlockBackupPassphraseSession();
      const pkg = await assemblePairLoginPackage();
      const { envelope } = encryptPairPayload(
        encodePairLoginPackage(pkg),
        session.pubCompressed,
      );
      const wire = encodeWireEnvelope(envelope);
      await session.sendCipherAndWaitAck({
        wireBytes: wire,
        onStatus: setStatus,
        signal: ac.signal,
      });
      setPhase("done");
      setStatus("Paired. Opening Home…");
      setPending(null);
      Alert.alert("Paired", "The other phone confirmed login.");
      navigation.navigate("Home");
    } catch (e) {
      if (ac.signal.aborted) return;
      approveLock.current = false;
      setPhase("idle");
      setStatus("");
      setPending(null);
      await session.cancel().catch(() => undefined);
      Alert.alert("Pairing failed", e instanceof Error ? e.message : "Unknown error");
      await cancelPairBle();
    }
  }

  function onCancel() {
    abortRef.current?.abort();
    approveLock.current = false;
    void pending?.session.cancel();
    void cancelPairBle();
    setPhase("idle");
    setStatus("");
    setPending(null);
  }

  const scanning = phase === "scanning";
  const confirming = phase === "confirm";
  const approving = phase === "approving";
  const sending = phase === "sending";
  const busy = scanning || approving || sending;

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={ui.title}>PAIR WITH BLUETOOTH</Text>
        <Text style={ui.caption}>
          Move wallets to a nearby phone that is on the Basic welcome screen.
          {"\n"}Secrets stay encrypted over Bluetooth.
        </Text>

        <View style={ui.cardMuted}>
          {[
            "Open Basic on the new device and tap pair.",
            "Grant Bluetooth, then match the code shown there.",
            "Tap Start scan here, confirm the same code, then biometrics.",
          ].map((line) => (
            <Text key={line} style={[ui.caption, { textAlign: "left", marginBottom: 10 }]}>
              · {line}
            </Text>
          ))}
        </View>

        {pending && (confirming || approving) ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>Pairing code</Text>
            <Text style={styles.codeValue} selectable>
              {pending.lobbyId}
            </Text>
            <Text style={styles.codeHint}>
              Must match the code on the new phone before you approve.
            </Text>
          </View>
        ) : null}

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {confirming || approving ? (
          <>
            <Pressable
              style={[ui.primaryBtn, (approving || sending) && { opacity: 0.6 }]}
              disabled={approving || sending}
              onPress={() => void onApprove()}
              hitSlop={12}
            >
              {approving ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={ui.primaryBtnText}>Approve this code</Text>
              )}
            </Pressable>
            <Pressable style={ui.secondaryBtn} onPress={onCancel} disabled={sending}>
              <Text style={ui.secondaryBtnText}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => void onStart()}
            >
              {scanning || sending ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={ui.primaryBtnText}>Start scan</Text>
              )}
            </Pressable>

            {scanning || sending ? (
              <Pressable style={ui.secondaryBtn} onPress={onCancel}>
                <Text style={ui.secondaryBtnText}>Cancel</Text>
              </Pressable>
            ) : null}
          </>
        )}
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
  codeCard: {
    marginTop: 20,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.fg,
    backgroundColor: colors.card,
    alignItems: "center",
  },
  codeLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 10,
  },
  codeValue: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 22,
    color: colors.fg,
    letterSpacing: 1,
    textAlign: "center",
  },
  codeHint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 17,
  },
});
