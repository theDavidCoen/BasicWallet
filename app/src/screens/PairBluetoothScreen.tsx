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
import { BackupPassphraseSheet } from "../components/BackupPassphraseSheet";
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
  type PairLoginPackage,
} from "../pair/pairLoginPackage";
import {
  encodeWireEnvelope,
  encryptPairPayload,
  lobbyIdFromPub,
  verifyLobbyBind,
} from "../pair/pairProtocol";
import {
  ensureBackupPassphraseForPair,
  isCloudBackupMetaArmed,
} from "../nostr/backupSync";
import {
  beginPresencePrompt,
  endPresencePrompt,
} from "../security/presencePrompt";
import { requireUserPresence } from "../security/userPresence";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

type Phase =
  | "idle"
  | "scanning"
  | "confirm"
  | "approving"
  | "passphrase"
  | "sending"
  | "done";

type PendingHello = {
  session: ApproverBleSession;
  lobbyId: string;
};

export function PairBluetoothScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const { hasWallet } = useWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<PendingHello | null>(null);
  const [passphraseSheetOpen, setPassphraseSheetOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const approveLock = useRef(false);
  const passphraseWaitRef = useRef<{
    resolve: (passphrase: string) => void;
    reject: (err: Error) => void;
  } | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      void pending?.session.cancel();
      void cancelPairBle();
      passphraseWaitRef.current?.reject(new Error(t("pair.cancelled")));
      passphraseWaitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, []);

  function promptBackupPassphraseForPair(): Promise<string> {
    setPassphraseSheetOpen(true);
    setPhase("passphrase");
    setStatus(t("pair.statusPassphrase"));
    return new Promise((resolve, reject) => {
      passphraseWaitRef.current = { resolve, reject };
    });
  }

  function onPassphraseArmed(passphrase: string) {
    const wait = passphraseWaitRef.current;
    passphraseWaitRef.current = null;
    setPassphraseSheetOpen(false);
    wait?.resolve(passphrase);
  }

  function onPassphraseDismiss() {
    setPassphraseSheetOpen(false);
    const wait = passphraseWaitRef.current;
    if (!wait) return;
    passphraseWaitRef.current = null;
    wait.reject(new Error(t("pair.cancelledPass")));
  }

  async function onStart() {
    if (!hasWallet) {
      Alert.alert(t("pair.noWalletTitle"), t("pair.noWalletBody"));
      return;
    }
    abortRef.current?.abort();
    await pending?.session.cancel().catch(() => undefined);
    const ac = new AbortController();
    abortRef.current = ac;
    approveLock.current = false;
    setPending(null);
    setPhase("scanning");
    setStatus(t("pair.statusBlePerm"));
    const permitted = await ensureBlePermissions();
    if (ac.signal.aborted) return;
    if (!permitted) {
      setPhase("idle");
      setStatus("");
      Alert.alert(
        t("pair.blePermTitle"),
        t("pair.blePermBody"),
      );
      return;
    }
    setStatus(t("pair.statusScanning"));
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
      setStatus(t("pair.statusCompare"));
    } catch (e) {
      if (ac.signal.aborted) return;
      setPhase("idle");
      setStatus("");
      setPending(null);
      Alert.alert(t("pair.failedTitle"), e instanceof Error ? e.message : t("common.unknownError"));
      await cancelPairBle();
    }
  }

  async function onApprove() {
    if (!pending || approveLock.current) return;
    if (phase !== "confirm") return;
    approveLock.current = true;
    setPhase("approving");
    setStatus(t("pair.statusBio"));

    const ac = abortRef.current ?? new AbortController();
    abortRef.current = ac;
    const { session, lobbyId } = pending;

    try {
      const auth = await requireUserPresence(
        t("pair.authApprove", { code: lobbyId }),
      );
      if (!auth.ok) {
        approveLock.current = false;
        setPhase("confirm");
        setStatus(t("pair.statusCompare"));
        return;
      }

      setPhase("sending");
      setStatus(t("pair.statusBuilding"));
      // Keep AppLock from clearing the RAM session while we reload SecureStore
      // and pack (UV bio sheet often backgrounds the app on Xiaomi/Samsung).
      beginPresencePrompt();
      let pkg: PairLoginPackage;
      try {
        let passphrase = await ensureBackupPassphraseForPair();
        if (!passphrase && (await isCloudBackupMetaArmed())) {
          // Empty SecureStore (not a UV race): prompt once, persist, continue.
          // Hold presence latch across the sheet so AppLock cannot wipe the
          // freshly persisted session before assemble reads it.
          console.warn(
            "[basic] pair: backup ON but SecureStore passphrase empty — prompting Device 1",
          );
          setStatus(t("pair.statusEnterPass"));
          passphrase = await promptBackupPassphraseForPair();
          setPhase("sending");
          setStatus(t("pair.statusBuilding"));
        }
        void passphrase;
        pkg = await assemblePairLoginPackage();
      } finally {
        endPresencePrompt();
      }
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
      setStatus(t("pair.statusDone"));
      setPending(null);
      Alert.alert(t("pair.pairedTitle"), t("pair.pairedBody"));
      navigation.navigate("Home");
    } catch (e) {
      if (ac.signal.aborted) return;
      approveLock.current = false;
      setPassphraseSheetOpen(false);
      passphraseWaitRef.current = null;
      setPhase("idle");
      setStatus("");
      setPending(null);
      await session.cancel().catch(() => undefined);
      Alert.alert(t("pair.failedTitle"), e instanceof Error ? e.message : t("common.unknownError"));
      await cancelPairBle();
    }
  }

  function onCancel() {
    abortRef.current?.abort();
    approveLock.current = false;
    if (passphraseWaitRef.current) {
      passphraseWaitRef.current.reject(new Error(t("pair.cancelled")));
      passphraseWaitRef.current = null;
    }
    setPassphraseSheetOpen(false);
    void pending?.session.cancel();
    void cancelPairBle();
    setPhase("idle");
    setStatus("");
    setPending(null);
  }

  const scanning = phase === "scanning";
  const confirming = phase === "confirm";
  const approving = phase === "approving";
  const needingPassphrase = phase === "passphrase";
  const sending = phase === "sending";
  const busy = scanning || approving || sending || needingPassphrase;

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={ui.title}>{t("pair.title")}</Text>
        <Text style={ui.caption}>{t("pair.caption")}</Text>

        <View style={ui.cardMuted}>
          {[t("pair.step1"), t("pair.step2"), t("pair.step3")].map((line) => (
            <Text key={line} style={[ui.caption, { textAlign: "left", marginBottom: 10 }]}>
              · {line}
            </Text>
          ))}
        </View>

        {pending && (confirming || approving || needingPassphrase) ? (
          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>{t("pair.codeLabel")}</Text>
            <Text style={styles.codeValue} selectable>
              {pending.lobbyId}
            </Text>
            <Text style={styles.codeHint}>{t("pair.codeHint")}</Text>
          </View>
        ) : null}

        {status ? <Text style={styles.status}>{status}</Text> : null}

        {confirming || approving || needingPassphrase ? (
          <>
            <Pressable
              style={[
                ui.primaryBtn,
                (approving || sending || needingPassphrase) && { opacity: 0.6 },
              ]}
              disabled={approving || sending || needingPassphrase}
              onPress={() => void onApprove()}
              hitSlop={12}
            >
              {approving || needingPassphrase ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={ui.primaryBtnText}>{t("pair.approve")}</Text>
              )}
            </Pressable>
            <Pressable
              style={ui.secondaryBtn}
              onPress={onCancel}
              disabled={sending && !needingPassphrase}
            >
              <Text style={ui.secondaryBtnText}>{t("common.cancel")}</Text>
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
                <Text style={ui.primaryBtnText}>{t("pair.startScan")}</Text>
              )}
            </Pressable>

            {scanning || sending ? (
              <Pressable style={ui.secondaryBtn} onPress={onCancel}>
                <Text style={ui.secondaryBtnText}>{t("common.cancel")}</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>

      <BackupPassphraseSheet
        open={passphraseSheetOpen}
        mode="pair"
        onDismiss={onPassphraseDismiss}
        onArmed={onPassphraseArmed}
      />
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
