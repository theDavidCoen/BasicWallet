import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useCallback, useMemo, useState } from "react";
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
import { BackupPassphraseLiveRules } from "../components/BackupPassphraseLiveRules";
import { PassphraseInput } from "../components/PassphraseInput";
import {
  DEFAULT_NOSTR_RELAYS,
  disableEncryptedBackup,
  readBackupMeta,
  writeBackupMeta,
  type BackupPackageMeta,
} from "../nostr/backupPackage";
import {
  hasSessionBackupPassphrase,
  persistBackupPassphrase,
  syncEncryptedBackupNow,
  unlockBackupPassphraseSession,
} from "../nostr/backupSync";
import { BACKUP_PASSPHRASE_HINT, validateBackupPassphrase } from "../nostr/passphrasePolicy";
import { backupPassphraseChecklist } from "../nostr/passphrasePolicy";
import { ensureNostrIdentity, hasNostrIdentity } from "../nostr/identityStore";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

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

/** Penpot 12d — enable / disable Nostr AEAD package + passphrase. Next → Recap. */
export function NostrBackupScreen() {
  const navigation = useNavigation<RootNav>();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [customRelays, setCustomRelays] = useState<string[]>([]);
  const [nostrEnabled, setNostrEnabled] = useState(false);
  const [backupMeta, setBackupMeta] = useState<BackupPackageMeta | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  const checklist = useMemo(
    () => backupPassphraseChecklist(passphrase, confirm),
    [passphrase, confirm],
  );

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

  async function persistRelays(meta: BackupPackageMeta): Promise<BackupPackageMeta | null> {
    const relays = buildRelayList();
    if (!relays) return null;
    const next = { ...meta, relays };
    await writeBackupMeta(next);
    setBackupMeta(next);
    return next;
  }

  async function onNext() {
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
      if (!(await hasNostrIdentity())) {
        await ensureNostrIdentity();
      }
      navigation.navigate("BackupRecap", {
        channel: "nostr",
        passphrase: check.passphrase,
        relays,
      });
    } catch (e) {
      Alert.alert(
        "Could not continue",
        e instanceof Error ? e.message : "Unknown error",
      );
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
            <Text style={[styles.section, { marginTop: 28 }]}>Backup passphrase</Text>
            <Text style={[ui.hint, { marginTop: 8, marginBottom: 4 }]}>
              {BACKUP_PASSPHRASE_HINT}
            </Text>
            <Text style={styles.label}>passphrase</Text>
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
            <BackupPassphraseLiveRules passphrase={passphrase} confirm={confirm} />

            <Pressable
              style={[
                ui.primaryBtn,
                { marginTop: 24 },
                (busy || !checklist.allOk) && { opacity: 0.6 },
              ]}
              disabled={busy || !checklist.allOk}
              onPress={() => void onNext()}
            >
              {busy ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={ui.primaryBtnText}>Next</Text>
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
  section: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 12,
    color: colors.fg,
  },
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
