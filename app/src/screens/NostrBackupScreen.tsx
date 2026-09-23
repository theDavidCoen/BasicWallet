import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { mnemonicFromEntropy, randomEntropy32 } from "../onboarding/mnemonicFromEntropy";
import {
  DEFAULT_NOSTR_RELAYS,
  PASSPHRASE_LOSS_CAPTION,
  disableEncryptedBackup,
  enableEncryptedBackup,
  readBackupMeta,
  writeBackupMeta,
  type BackupPackageMeta,
} from "../nostr/backupPackage";
import {
  publishEncryptedBackupToRelays,
  rememberPublishMeta,
} from "../nostr/backupBroadcast";
import {
  hasSessionBackupPassphrase,
  persistBackupPassphrase,
  syncEncryptedBackupNow,
  unlockBackupPassphraseSession,
} from "../nostr/backupSync";
import { BACKUP_PASSPHRASE_HINT, BACKUP_PASSPHRASE_RULES, validateBackupPassphrase } from "../nostr/passphrasePolicy";
import { ensureNostrIdentity, hasNostrIdentity } from "../nostr/identityStore";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";
import { PassphraseInput } from "../components/PassphraseInput";

const MAX_CUSTOM_RELAYS = 3;

function normalizeRelayUrl(raw: string): string | null {
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) return null;
  if (!/^wss:\/\//i.test(t) && !/^ws:\/\//i.test(t)) return null;
  return t;
}

function customRelaysFromMeta(meta: BackupPackageMeta | null): string[] {
  if (!meta?.relays?.length) return [];
  const defaults = new Set(DEFAULT_NOSTR_RELAYS.map((u) => u.toLowerCase()));
  return meta.relays
    .filter((u) => !defaults.has(u.trim().replace(/\/+$/, "").toLowerCase()))
    .slice(0, MAX_CUSTOM_RELAYS);
}

/** Penpot 12d — enable / disable Nostr AEAD package + passphrase. */
export function NostrBackupScreen() {
  const navigation = useNavigation<RootNav>();
  const { hasWallet, provisionFromMnemonic, noteLocalSend } = useWallet();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [customRelays, setCustomRelays] = useState<string[]>([]);
  const [nostrEnabled, setNostrEnabled] = useState(false);
  const [backupMeta, setBackupMeta] = useState<BackupPackageMeta | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const wasEmpty = !hasWallet;

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const meta = await readBackupMeta();
        setBackupMeta(meta);
        setNostrEnabled(!!(meta?.enabled && meta.channel === "nostr"));
        setCustomRelays(customRelaysFromMeta(meta));
        // Warm / detect Path C session after biometrics unlock.
        if (meta?.enabled) {
          if (!hasSessionBackupPassphrase()) {
            await unlockBackupPassphraseSession();
          }
          setSessionReady(hasSessionBackupPassphrase());
        } else {
          setSessionReady(false);
        }
      })();
    }, []),
  );

  function buildRelayList(): string[] | null {
    const out = [...DEFAULT_NOSTR_RELAYS];
    const seen = new Set(out.map((u) => u.toLowerCase()));
    for (const raw of customRelays) {
      const url = normalizeRelayUrl(raw);
      if (!url) {
        if (raw.trim()) {
          Alert.alert("Invalid relay", "Custom relays must start with wss:// (or ws://).");
          return null;
        }
        continue;
      }
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(url);
    }
    return out;
  }

  function addCustomRelay() {
    if (customRelays.length >= MAX_CUSTOM_RELAYS) return;
    setCustomRelays((prev) => [...prev, ""]);
  }

  function updateCustomRelay(index: number, value: string) {
    setCustomRelays((prev) => prev.map((u, i) => (i === index ? value : u)));
  }

  function removeCustomRelay(index: number) {
    setCustomRelays((prev) => prev.filter((_, i) => i !== index));
  }

  async function publishAfterPack(meta: BackupPackageMeta): Promise<string> {
    try {
      const pub = await publishEncryptedBackupToRelays(meta.relays);
      const next = await rememberPublishMeta(meta, pub);
      setBackupMeta(next);
      const failNote = pub.failedRelays.length
        ? ` (${pub.failedRelays.length} relay(s) failed)`
        : "";
      return `Published NIP-44 ciphertext to ${pub.okRelays.length} relay(s)${failNote}.`;
    } catch (e) {
      return `Local package saved; relay publish failed: ${
        e instanceof Error ? e.message : "unknown"
      }`;
    }
  }

  async function persistRelays(meta: BackupPackageMeta): Promise<BackupPackageMeta | null> {
    const relays = buildRelayList();
    if (!relays) return null;
    const next = { ...meta, relays };
    await writeBackupMeta(next);
    setBackupMeta(next);
    return next;
  }

  async function onEnable() {
    const check = validateBackupPassphrase(passphrase);
    if (!check.ok) {
      Alert.alert("Invalid passphrase", check.message);
      return;
    }
    if (passphrase !== confirm) {
      Alert.alert("Mismatch", "Passphrase and confirmation do not match.");
      return;
    }
    const relays = buildRelayList();
    if (!relays) return;

    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm to enable Nostr backup");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Backup was not enabled.");
        return;
      }
      // Rematerialize / WS replay after the bio sheet must not look like fresh receives.
      noteLocalSend();

      if (!(await hasNostrIdentity())) {
        await ensureNostrIdentity();
      }

      // Onboarding Path C: create wallet before packaging if none yet.
      if (!hasWallet) {
        const mnemonic = mnemonicFromEntropy(await randomEntropy32());
        await provisionFromMnemonic(mnemonic, "device-only");
      }

      await ensureNostrIdentity();
      const meta = await enableEncryptedBackup({
        channel: "nostr",
        passphrase,
        relays,
      });
      setNostrEnabled(true);
      setBackupMeta(meta);

      const publishNote = await publishAfterPack(meta);

      const afterEnable = wasEmpty ? ("Ready" as const) : ("AdvancedBackup" as const);
      Alert.alert(
        "Nostr backup enabled",
        `${meta.walletCount} wallet(s)` +
          (meta.txMetaCount ? `, ${meta.txMetaCount} note(s)` : "") +
          " packaged (passphrase AEAD).\n\n" +
          publishNote +
          "\n\nNext: save your nsec offline. You need nsec + passphrase to restore.",
        [
          {
            text: "Export nsec",
            onPress: () =>
              navigation.replace("ExportNsecWarning", { afterEnable }),
          },
        ],
      );
    } catch (e) {
      Alert.alert("Could not enable backup", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function onUpdateAndPublish() {
    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm to update Nostr backup");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Backup was not updated.");
        return;
      }
      // UV can clear RAM briefly; reload SecureStore passphrase after unlock grant.
      await unlockBackupPassphraseSession();
      setSessionReady(hasSessionBackupPassphrase());

      if (!hasSessionBackupPassphrase()) {
        const check = validateBackupPassphrase(passphrase);
        if (!check.ok) {
          Alert.alert(
            "Passphrase needed",
            "Session is locked. Enter your backup passphrase once, or unlock the app with biometrics.",
          );
          return;
        }
        await persistBackupPassphrase(passphrase);
        setSessionReady(true);
      }

      // Persist relay edits first, then re-pack + publish from session.
      const current = backupMeta ?? (await readBackupMeta());
      if (!current) throw new Error("No local backup meta");
      const withRelays = await persistRelays(current);
      if (!withRelays) return;

      const synced = await syncEncryptedBackupNow("manual-update-publish");
      if (!synced) {
        throw new Error("Could not update backup (missing session passphrase).");
      }
      setBackupMeta(synced);
      setPassphrase("");
      Alert.alert(
        "Backup updated",
        `${synced.walletCount} wallet(s)` +
          (synced.txMetaCount ? `, ${synced.txMetaCount} note(s)` : "") +
          " re-packed and published.",
      );
    } catch (e) {
      Alert.alert("Update failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm to disable Nostr backup");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Backup was not disabled.");
        return;
      }
      await disableEncryptedBackup();
      setNostrEnabled(false);
      setBackupMeta(null);
      setCustomRelays([]);
      setPassphrase("");
      setConfirm("");
      Alert.alert(
        "Nostr backup disabled",
        "Local encrypted package removed. Wallets on this device are unchanged. Relay events are not deleted.",
      );
      navigation.navigate("AdvancedBackup");
    } catch (e) {
      Alert.alert("Could not disable", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={ui.title}>NOSTR BACKUP</Text>
        <Text style={ui.caption}>
          AEAD package of ALL wallets + notes.{"\n"}
          Relays get NIP-44 ciphertext only.
        </Text>

        <Text style={styles.label}>relays</Text>
        {DEFAULT_NOSTR_RELAYS.map((url) => (
          <View key={url} style={styles.relayRow}>
            <Text style={styles.relayUrl}>{url}</Text>
            <Text style={styles.relayOn}>ON</Text>
          </View>
        ))}

        {customRelays.map((url, index) => (
          <View key={`custom-${index}`} style={styles.customRow}>
            <TextInput
              style={styles.customInput}
              value={url}
              onChangeText={(v) => updateCustomRelay(index, v)}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="wss://relay.example.com"
              placeholderTextColor={colors.hint}
            />
            <Pressable
              onPress={() => removeCustomRelay(index)}
              hitSlop={8}
              accessibilityLabel="Remove custom relay"
            >
              <Text style={styles.removeBtn}>✕</Text>
            </Pressable>
          </View>
        ))}

        {customRelays.length < MAX_CUSTOM_RELAYS ? (
          <Pressable style={styles.addRelayBtn} onPress={addCustomRelay}>
            <Text style={styles.addRelayText}>+ Add custom relay</Text>
          </Pressable>
        ) : null}

        {!nostrEnabled ? (
          <>
            <Text style={styles.label}>backup passphrase</Text>
            <PassphraseInput
              value={passphrase}
              onChangeText={setPassphrase}
              placeholder="••••••••••••"
            />

            <Text style={styles.label}>confirm passphrase</Text>
            <PassphraseInput
              value={confirm}
              onChangeText={setConfirm}
              placeholder="••••••••••••"
            />

            <Text style={[ui.hint, { marginTop: 16 }]}>
              {BACKUP_PASSPHRASE_RULES}
              {"\n\n"}
              {BACKUP_PASSPHRASE_HINT}
              {"\n\n"}
              {PASSPHRASE_LOSS_CAPTION}
            </Text>

            <Pressable
              style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => void onEnable()}
            >
              {busy ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={ui.primaryBtnText}>Enable Nostr backup</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[ui.hint, { marginTop: 20 }]}>
              Nostr backup is active.{"\n"}
              {backupMeta?.lastPublishedAt
                ? `Last publish: ${new Date(backupMeta.lastPublishedAt).toLocaleString()} · ${backupMeta.lastPublishOk ?? 0} ok`
                : "Not published to relays yet."}
              {"\n\n"}
              After you unlock the app (biometrics), new wallets / renames / notes
              sync automatically until you leave the app.
            </Text>

            {sessionReady ? (
              <Text style={[ui.hint, { marginTop: 16 }]}>
                Session unlocked — Update & publish uses the stored passphrase (no re-entry).
              </Text>
            ) : (
              <>
                <Text style={styles.label}>passphrase (session locked)</Text>
                <PassphraseInput
                  value={passphrase}
                  onChangeText={setPassphrase}
                  placeholder="••••••••••••"
                />
              </>
            )}

            <Pressable
              style={[ui.primaryBtn, { marginTop: 16 }, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => void onUpdateAndPublish()}
            >
              {busy ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={ui.primaryBtnText}>Update & publish</Text>
              )}
            </Pressable>

            <Pressable
              style={[ui.secondaryBtn, { marginTop: 12 }, busy && { opacity: 0.6 }]}
              disabled={busy}
              onPress={() => void onDisable()}
            >
              {busy ? (
                <ActivityIndicator color={colors.fg} />
              ) : (
                <Text style={ui.secondaryBtnText}>Disable Nostr backup</Text>
              )}
            </Pressable>
          </>
        )}
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 16,
    marginBottom: 8,
  },
  relayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  relayUrl: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
    flex: 1,
  },
  relayOn: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.hint,
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.fg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    backgroundColor: colors.card,
  },
  removeBtn: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 16,
    color: colors.hint,
    paddingHorizontal: 4,
  },
  addRelayBtn: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  addRelayText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    color: colors.fg,
  },
});
