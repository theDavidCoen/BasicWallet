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
import { validateBackupPassphrase } from "../nostr/passphrasePolicy";
import { backupPassphraseChecklist } from "../nostr/passphrasePolicy";
import { ensureNostrIdentity, hasNostrIdentity } from "../nostr/identityStore";
import { requireUserPresence } from "../security/userPresence";
import { AdaptiveText, useI18n } from "../i18n";
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
  const { t } = useI18n();
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
          Alert.alert(t("backup.invalidRelayTitle"), t("backup.invalidRelayBody"));
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
      Alert.alert(t("backup.invalidPassphrase"), check.message);
      return;
    }
    if (passphrase !== confirm) {
      Alert.alert(t("backup.mismatchTitle"), t("backup.mismatchBody"));
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
        t("backup.couldNotContinue"),
        e instanceof Error ? e.message : t("common.unknownError"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onUpdateAndPublish() {
    setBusy(true);
    try {
      const auth = await requireUserPresence(t("backup.confirmUpdateNostr"));
      if (!auth.ok) {
        Alert.alert(t("backup.authRequired"), t("backup.backupNotUpdated"));
        return;
      }
      // UV can clear RAM briefly; reload SecureStore passphrase after unlock grant.
      await unlockBackupPassphraseSession();
      setSessionReady(hasSessionBackupPassphrase());

      if (!hasSessionBackupPassphrase()) {
        const check = validateBackupPassphrase(passphrase);
        if (!check.ok) {
          Alert.alert(
            t("backup.passphraseNeededTitle"),
            t("backup.passphraseNeededBody"),
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
        t("backup.backupUpdatedTitle"),
        t("backup.backupUpdatedNostrBody", {
          wallets: synced.walletCount,
          notes: synced.txMetaCount
            ? t("backup.notesPart", { notes: synced.txMetaCount })
            : "",
        }),
      );
    } catch (e) {
      Alert.alert(t("backup.updateFailed"), e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  }

  async function onDisable() {
    setBusy(true);
    try {
      const auth = await requireUserPresence(t("backup.confirmDisableNostr"));
      if (!auth.ok) {
        Alert.alert(t("backup.authRequired"), t("backup.backupNotDisabled"));
        return;
      }
      await disableEncryptedBackup();
      setNostrEnabled(false);
      setBackupMeta(null);
      setCustomRelays([]);
      setPassphrase("");
      setConfirm("");
      Alert.alert(
        t("backup.nostrDisabledTitle"),
        t("backup.nostrDisabledBody"),
      );
      navigation.navigate("AdvancedBackup");
    } catch (e) {
      Alert.alert(t("backup.couldNotDisable"), e instanceof Error ? e.message : t("common.unknownError"));
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
        <Text style={ui.title}>{t("backup.nostrScreenTitle")}</Text>
        <Text style={ui.caption}>{t("backup.nostrCaption")}</Text>

        <Text style={styles.label}>{t("backup.relaysLabel")}</Text>
        {DEFAULT_NOSTR_RELAYS.map((url) => (
          <View key={url} style={styles.relayRow}>
            <Text style={styles.relayUrl}>{url}</Text>
            <Text style={styles.relayOn}>{t("backup.relayOn")}</Text>
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
              placeholder={t("backup.relayPlaceholder")}
              placeholderTextColor={colors.hint}
            />
            <Pressable
              onPress={() => removeCustomRelay(index)}
              hitSlop={8}
              accessibilityLabel={t("backup.removeRelayA11y")}
            >
              <Text style={styles.removeBtn}>✕</Text>
            </Pressable>
          </View>
        ))}

        {customRelays.length < MAX_CUSTOM_RELAYS ? (
          <Pressable style={styles.addRelayBtn} onPress={addCustomRelay}>
            <AdaptiveText style={styles.addRelayText} baseFontSize={14}>{t("backup.addCustomRelay")}</AdaptiveText>
          </Pressable>
        ) : null}

        {!nostrEnabled ? (
          <>
            <Text style={[styles.section, { marginTop: 28 }]}>{t("backup.passphraseSection")}</Text>
            <Text style={[ui.hint, { marginTop: 8, marginBottom: 4 }]}>
              {t("backup.passphraseHint")}
            </Text>
            <Text style={styles.label}>{t("backup.passphraseLabel")}</Text>
            <PassphraseInput
              value={passphrase}
              onChangeText={setPassphrase}
              placeholder="••••••••••••"
            />

            <Text style={styles.label}>{t("backup.confirmPassphraseLabel")}</Text>
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
                <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>{t("backup.next")}</AdaptiveText>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[ui.hint, { marginTop: 20 }]}>
              {t("backup.nostrActiveHint", {
                publishLine: backupMeta?.lastPublishedAt
                  ? t("backup.lastPublish", {
                      when: new Date(backupMeta.lastPublishedAt).toLocaleString(),
                      ok: backupMeta.lastPublishOk ?? 0,
                    })
                  : t("backup.notPublishedYet"),
              })}
            </Text>

            {sessionReady ? (
              <Text style={[ui.hint, { marginTop: 16 }]}>
                {t("backup.sessionUnlocked")}
              </Text>
            ) : (
              <>
                <Text style={styles.label}>{t("backup.passphraseSessionLocked")}</Text>
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
                <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>{t("backup.updateAndPublish")}</AdaptiveText>
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
                <AdaptiveText style={ui.secondaryBtnText} baseFontSize={15}>{t("backup.disableNostr")}</AdaptiveText>
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
