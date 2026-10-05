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
} from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { BackupPassphraseLiveRules } from "../components/BackupPassphraseLiveRules";
import { PassphraseInput } from "../components/PassphraseInput";
import { backupPassphraseChecklist, validateBackupPassphrase } from "../nostr/passphrasePolicy";
import {
  disableEncryptedBackup,
  readBackupMeta,
  type BackupPackageMeta,
} from "../nostr/backupPackage";
import { homeCredsHaveAuth } from "../nostr/homeServerCreds";
import { ensureNostrIdentity, hasNostrIdentity } from "../nostr/identityStore";
import {
  hasSessionBackupPassphrase,
  persistBackupPassphrase,
  syncEncryptedBackupNow,
  unlockBackupPassphraseSession,
} from "../nostr/backupSync";
import { requireUserPresence } from "../security/userPresence";
import { useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

/** Penpot 12e — home server channel; Next → Backup Recap when enabling. */
export function HomeServerBackupScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [homeEnabled, setHomeEnabled] = useState(false);
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
        const on = !!(meta?.enabled && meta.channel === "home");
        setHomeEnabled(on);
        if (on && meta?.homeUrl) setUrl(meta.homeUrl);
        if (on) {
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

  async function onNext() {
    if (!url.trim()) {
      Alert.alert(t("backup.serverUrlRequiredTitle"), t("backup.serverUrlRequiredBody"));
      return;
    }
    const creds = {
      token: token.trim() || null,
      username: username.trim() || null,
      password: appPassword.trim() || null,
    };
    if (!homeCredsHaveAuth(creds)) {
      Alert.alert(
        t("backup.credentialsRequiredTitle"),
        t("backup.credentialsRequiredBody"),
      );
      return;
    }
    if (creds.username && !creds.password) {
      Alert.alert(t("backup.appPasswordRequiredTitle"), t("backup.appPasswordRequiredBody"));
      return;
    }
    if (creds.password && !creds.username) {
      Alert.alert(t("backup.usernameRequiredTitle"), t("backup.usernameRequiredBody"));
      return;
    }

    const check = validateBackupPassphrase(passphrase);
    if (!check.ok) {
      Alert.alert(t("backup.invalidPassphrase"), check.message);
      return;
    }
    if (passphrase !== confirm) {
      Alert.alert(t("backup.mismatchTitle"), t("backup.mismatchBody"));
      return;
    }

    setBusy(true);
    try {
      if (!(await hasNostrIdentity())) {
        await ensureNostrIdentity();
      }
      navigation.navigate("BackupRecap", {
        channel: "home",
        passphrase: check.passphrase,
        homeUrl: url.trim(),
        homeToken: creds.token,
        homeUser: creds.username,
        homePassword: creds.password,
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

  async function onUpdateAndUpload() {
    setBusy(true);
    try {
      const auth = await requireUserPresence(t("backup.confirmUpdateHome"));
      if (!auth.ok) {
        Alert.alert(t("backup.authRequired"), t("backup.backupNotUpdated"));
        return;
      }
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

      const synced = await syncEncryptedBackupNow("manual-home-update");
      if (!synced) {
        throw new Error("Could not update backup (missing session passphrase).");
      }
      setBackupMeta(synced);
      setPassphrase("");
      Alert.alert(
        t("backup.backupUpdatedTitle"),
        t("backup.backupUpdatedHomeBody", {
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
      const auth = await requireUserPresence(t("backup.confirmDisableHome"));
      if (!auth.ok) {
        Alert.alert(t("backup.authRequired"), t("backup.backupNotDisabled"));
        return;
      }
      await disableEncryptedBackup();
      setHomeEnabled(false);
      setBackupMeta(null);
      setPassphrase("");
      setConfirm("");
      setSessionReady(false);
      Alert.alert(
        t("backup.homeDisabledTitle"),
        t("backup.homeDisabledBody"),
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
        <Text style={ui.title}>{t("backup.homeScreenTitle")}</Text>
        <Text style={ui.caption}>{t("backup.homeCaption")}</Text>

        {homeEnabled ? (
          <>
            <Text style={[ui.hint, { marginTop: 20 }]}>
              {t("backup.homeActiveHint", {
                urlLine: backupMeta?.homeUrl ? `\n${backupMeta.homeUrl}` : "",
                uploadLine: backupMeta?.lastPublishedAt
                  ? t("backup.lastUpload", {
                      when: new Date(backupMeta.lastPublishedAt).toLocaleString(),
                    })
                  : t("backup.localPackageReady"),
              })}
            </Text>

            {sessionReady ? (
              <Text style={[ui.hint, { marginTop: 16 }]}>
                {t("backup.sessionUnlockedHome")}
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
              onPress={() => void onUpdateAndUpload()}
            >
              {busy ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={ui.primaryBtnText}>{t("backup.updateAndUpload")}</Text>
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
                <Text style={ui.secondaryBtnText}>{t("backup.disableHome")}</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.label}>{t("backup.serverUrlLabel")}</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("backup.serverUrlPlaceholder")}
              placeholderTextColor={colors.hint}
            />
            <Text style={[ui.hint, { marginTop: 6 }]}>
              {t("backup.serverUrlHint")}
            </Text>

            <Text style={[styles.section, { marginTop: 20 }]}>{t("backup.nextcloudSection")}</Text>
            <Text style={styles.label}>{t("backup.usernameLabel")}</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("backup.usernamePlaceholder")}
              placeholderTextColor={colors.hint}
            />
            <Text style={styles.label}>{t("backup.appPasswordLabel")}</Text>
            <TextInput
              style={styles.input}
              value={appPassword}
              onChangeText={setAppPassword}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("backup.appPasswordPlaceholder")}
              placeholderTextColor={colors.hint}
              secureTextEntry
            />

            <Text style={[styles.section, { marginTop: 20 }]}>{t("backup.orTokenSection")}</Text>
            <Text style={styles.label}>{t("backup.bearerLabel")}</Text>
            <TextInput
              style={styles.input}
              value={token}
              onChangeText={setToken}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={t("backup.bearerPlaceholder")}
              placeholderTextColor={colors.hint}
              secureTextEntry
            />

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
                <Text style={ui.primaryBtnText}>{t("backup.next")}</Text>
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
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
  },
});
