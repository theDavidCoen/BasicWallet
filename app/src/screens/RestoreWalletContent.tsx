/**
 * Shared Restore / Import wallet form (sheet or full screen).
 */

import { useMemo, useState } from "react";
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
import { PassphraseInput } from "../components/PassphraseInput";
import {
  insertWallet,
  listWallets,
  removeWallet,
  setSelectedWalletId,
  type WalletKind,
} from "../account/walletRegistry";
import { getNetworkConfig } from "../config/network";
import {
  decryptPackage,
  DEFAULT_NOSTR_RELAYS,
  armBackupMetaAfterRestore,
  readCipherBlob,
  restoreContactsFromPackage,
  restorePrefsFromPackage,
  restoreTxMetaFromPackage,
  storeCipherBlob,
} from "../nostr/backupPackage";
import { fetchEncryptedBackupFromRelays } from "../nostr/backupBroadcast";
import { downloadHomeBackupCipher } from "../nostr/homeServerWebdav";
import { homeCredsHaveAuth } from "../nostr/homeServerCreds";
import { importAndStoreNsec, loadNostrKeyPairForCrypto } from "../nostr/identityStore";
import { syncContactsDirectoryNow } from "../contacts/contactsNostrSync";
import { persistBackupPassphrase } from "../nostr/backupSync";
import { hasMnemonic, storeMnemonic } from "../security/mnemonicStore";
import { requireUserPresence } from "../security/userPresence";
import { AdaptiveText, useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { createHdWalletFromMnemonic } from "../wallet/hdWallet";
import { setMnemonicSource } from "../wallet/mnemonicMeta";
import { useWallet } from "../wallet/WalletProvider";

type Tab = "seed" | "nsec" | "server";

export type RestoreWalletMode = "seed" | "full";

type Props = {
  mode?: RestoreWalletMode;
  /** When true, append passkey limitation note to the caption. */
  passkeyInstall?: boolean;
  onDone: (destination: "Home" | "Ready") => void;
  onCreateInstead?: () => void;
  /** When nsec imported but no package found. */
  onNostrIdentityOnly?: () => void;
  /** Sheet layout: no outer chrome padding assumptions. */
  embedded?: boolean;
};

export function RestoreWalletContent({
  mode = "full",
  passkeyInstall = false,
  onDone,
  onCreateInstead,
  onNostrIdentityOnly,
  embedded = false,
}: Props) {
  const { t } = useI18n();
  const seedOnly = mode === "seed";
  const { hasWallet, beginQuietImportSync, selectWallet } = useWallet();

  const [tab, setTab] = useState<Tab>("seed");
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState("");
  const [nsec, setNsec] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [serverUser, setServerUser] = useState("");
  const [serverAppPassword, setServerAppPassword] = useState("");
  const [serverToken, setServerToken] = useState("");

  // Sheet add-wallet: IMPORT. Settings → Arkade → Restore Wallet: RESTORE WALLET.
  const title = useMemo(() => {
    if (!seedOnly) return t("restore.title");
    return embedded ? t("restore.titleImport") : t("restore.titleWallet");
  }, [embedded, seedOnly, t]);
  const caption = useMemo(() => {
    if (seedOnly) {
      return (
        t("restore.captionSeedOnly") +
        (passkeyInstall ? t("restore.captionSeedPasskeyNote") : "")
      );
    }
    return (
      t("restore.captionFull") +
      (passkeyInstall ? t("restore.captionFullPasskeyNote") : "")
    );
  }, [passkeyInstall, seedOnly, t]);

  async function onRestoreSeed() {
    const words = seed.trim().split(/\s+/).filter(Boolean);
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert(t("restore.invalidPhraseTitle"), t("restore.invalidPhraseBody"));
      return;
    }
    setBusy(true);
    try {
      const auth = await requireUserPresence(t("restore.confirmRestoreSeed"));
      if (!auth.ok) {
        Alert.alert(t("restore.authRequired"), t("restore.walletNotRestored"));
        return;
      }
      await setMnemonicSource("device-only");
      const networkId = getNetworkConfig().id;
      const label = hasWallet ? t("restore.labelRestored") : t("common.personal");
      const record = insertWallet(networkId, {
        kind: "arkade",
        label,
        tag: hasWallet ? null : "main",
      });
      await createHdWalletFromMnemonic(record.id, words.join(" "));
      setSelectedWalletId(networkId, record.id);
      beginQuietImportSync();
      await selectWallet(record.id);
      Alert.alert(t("restore.restoredTitle"), t("restore.restoredSeedBody"));
      onDone(seedOnly || hasWallet ? "Home" : "Ready");
    } catch (e) {
      Alert.alert(t("restore.restoreFailed"), e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  }

  async function onRestoreNsec() {
    if (!nsec.trim()) {
      Alert.alert(t("restore.requiredTitle"), t("restore.nsecRequired"));
      return;
    }
    if (!passphrase) {
      Alert.alert(t("restore.requiredTitle"), t("restore.passphraseRequired"));
      return;
    }
    setBusy(true);
    try {
      const auth = await requireUserPresence(t("restore.confirmRestoreNostr"));
      if (!auth.ok) {
        Alert.alert(t("restore.authRequired"), t("restore.packageNotRestored"));
        return;
      }

      await importAndStoreNsec(nsec);
      const pair = await loadNostrKeyPairForCrypto();
      if (!pair) throw new Error("Failed to store nsec");

      let blob = await readCipherBlob();
      if (!blob) {
        blob = await fetchEncryptedBackupFromRelays();
        if (blob) await storeCipherBlob(blob);
      }
      if (!blob) {
        await syncContactsDirectoryNow("restore-nsec-only");
        Alert.alert(
          t("restore.identityImportedTitle"),
          t("restore.identityImportedBody"),
        );
        onNostrIdentityOnly?.();
        return;
      }

      const pkg = await decryptPackage(blob, pair.nsec, passphrase);
      await persistBackupPassphrase(passphrase);
      const networkId = getNetworkConfig().id;

      console.warn(
        "[basic] nostr restore package",
        pkg.wallets.length,
        pkg.wallets.map((w) => w.label),
      );

      const restoredIds = new Set<string>();
      for (let i = 0; i < pkg.wallets.length; i++) {
        const entry = pkg.wallets[i]!;
        const kind = (entry.kind as WalletKind) || "arkade";
        const existing = entry.id
          ? listWallets(networkId).find((w) => w.id === entry.id)
          : undefined;
        const record =
          existing ??
          insertWallet(networkId, {
            id: entry.id,
            kind,
            label: entry.label || (i === 0 ? t("common.personal") : t("restore.walletN", { n: i + 1 })),
            tag: entry.tag,
          });
        await storeMnemonic(record.id, entry.mnemonic);
        restoredIds.add(record.id);
      }

      for (const w of listWallets(networkId)) {
        if (w.kind !== "arkade") continue;
        if (restoredIds.has(w.id)) continue;
        if (await hasMnemonic(w.id)) continue;
        removeWallet(networkId, w.id);
      }

      const notesRestored = restoreTxMetaFromPackage(pkg);
      const contactsRestored = restoreContactsFromPackage(pkg);
      // Flags only — no Enter/Exit swap. Enter stays HD (α10); prefs drive UI.
      const prefsRestored = await restorePrefsFromPackage(pkg);

      await armBackupMetaAfterRestore({
        channel: "nostr",
        npub: pair.npub,
        walletCount: pkg.wallets.length,
        txMetaCount: pkg.txMeta?.length,
        contactsCount: pkg.contacts?.length,
        prefsCount: prefsRestored,
        relays: DEFAULT_NOSTR_RELAYS,
      });

      const wallets = listWallets(networkId).filter((w) => restoredIds.has(w.id));
      if (!wallets.length) throw new Error("Package had no wallets");

      const preferred =
        wallets.find((w) => w.kind === "arkade" && (w.tag === "main" || w.label === "Personal")) ??
        wallets.find((w) => w.kind === "arkade") ??
        wallets[0]!;
      const packagePreferred =
        (pkg.wallets[0]?.id && wallets.find((w) => w.id === pkg.wallets[0]!.id)) || preferred;

      setSelectedWalletId(networkId, packagePreferred.id);
      await setMnemonicSource("device-only");
      beginQuietImportSync();
      await selectWallet(packagePreferred.id);

      const labels = pkg.wallets.map((w) => w.label || "?").join(", ");
      Alert.alert(
        t("restore.restoredTitle"),
        t("restore.restoredPackageBody", {
          count: pkg.wallets.length,
          labels,
          notes: notesRestored ? t("restore.notesLine", { count: notesRestored }) : "",
          contacts: contactsRestored
            ? t("restore.contactsLine", { count: contactsRestored })
            : "",
          prefs: prefsRestored ? t("restore.prefsLine", { count: prefsRestored }) : "",
        }),
      );
      onDone("Ready");
    } catch (e) {
      Alert.alert(
        t("restore.restoreFailed"),
        e instanceof Error ? e.message : t("restore.wrongPassphrase"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRestoreServer() {
    if (!serverUrl.trim()) {
      Alert.alert(t("restore.requiredTitle"), t("restore.serverUrlRequired"));
      return;
    }
    const creds = {
      token: serverToken.trim() || null,
      username: serverUser.trim() || null,
      password: serverAppPassword.trim() || null,
    };
    if (!homeCredsHaveAuth(creds)) {
      Alert.alert(
        t("restore.credentialsRequiredTitle"),
        t("restore.credentialsRequiredBody"),
      );
      return;
    }
    if (!nsec.trim()) {
      Alert.alert(t("restore.requiredTitle"), t("restore.nsecRequiredUnwrap"));
      return;
    }
    if (!passphrase) {
      Alert.alert(t("restore.requiredTitle"), t("restore.passphraseRequired"));
      return;
    }

    setBusy(true);
    try {
      const auth = await requireUserPresence(t("restore.confirmRestoreHome"));
      if (!auth.ok) {
        Alert.alert(t("restore.authRequired"), t("restore.packageNotRestored"));
        return;
      }

      const blob = await downloadHomeBackupCipher(serverUrl, creds);
      await storeCipherBlob(blob);

      await importAndStoreNsec(nsec);
      const pair = await loadNostrKeyPairForCrypto();
      if (!pair) throw new Error("Failed to store nsec");

      const pkg = await decryptPackage(blob, pair.nsec, passphrase);
      await persistBackupPassphrase(passphrase);
      const networkId = getNetworkConfig().id;

      const restoredIds = new Set<string>();
      for (let i = 0; i < pkg.wallets.length; i++) {
        const entry = pkg.wallets[i]!;
        const kind = (entry.kind as WalletKind) || "arkade";
        const existing = entry.id
          ? listWallets(networkId).find((w) => w.id === entry.id)
          : undefined;
        const record =
          existing ??
          insertWallet(networkId, {
            id: entry.id,
            kind,
            label: entry.label || (i === 0 ? t("common.personal") : t("restore.walletN", { n: i + 1 })),
            tag: entry.tag,
          });
        await storeMnemonic(record.id, entry.mnemonic);
        restoredIds.add(record.id);
      }

      for (const w of listWallets(networkId)) {
        if (w.kind !== "arkade") continue;
        if (restoredIds.has(w.id)) continue;
        if (await hasMnemonic(w.id)) continue;
        removeWallet(networkId, w.id);
      }

      const notesRestored = restoreTxMetaFromPackage(pkg);
      const contactsRestored = restoreContactsFromPackage(pkg);
      const prefsRestored = await restorePrefsFromPackage(pkg);

      await armBackupMetaAfterRestore({
        channel: "home",
        npub: pair.npub,
        walletCount: pkg.wallets.length,
        txMetaCount: pkg.txMeta?.length,
        contactsCount: pkg.contacts?.length,
        prefsCount: prefsRestored,
        homeUrl: serverUrl.trim(),
        homeToken: creds.token,
        homeUser: creds.username,
        homePassword: creds.password,
      });

      const wallets = listWallets(networkId).filter((w) => restoredIds.has(w.id));
      if (!wallets.length) throw new Error("Package had no wallets");

      const preferred =
        wallets.find((w) => w.kind === "arkade" && (w.tag === "main" || w.label === "Personal")) ??
        wallets.find((w) => w.kind === "arkade") ??
        wallets[0]!;
      const packagePreferred =
        (pkg.wallets[0]?.id && wallets.find((w) => w.id === pkg.wallets[0]!.id)) || preferred;

      setSelectedWalletId(networkId, packagePreferred.id);
      await setMnemonicSource("device-only");
      beginQuietImportSync();
      await selectWallet(packagePreferred.id);

      const labels = pkg.wallets.map((w) => w.label || "?").join(", ");
      Alert.alert(
        t("restore.restoredTitle"),
        t("restore.restoredHomeBody", {
          count: pkg.wallets.length,
          labels,
          notes: notesRestored ? t("restore.notesLine", { count: notesRestored }) : "",
          contacts: contactsRestored
            ? t("restore.contactsLine", { count: contactsRestored })
            : "",
          prefs: prefsRestored ? t("restore.prefsLine", { count: prefsRestored }) : "",
        }),
      );
      onDone("Ready");
    } catch (e) {
      Alert.alert(
        t("restore.restoreFailed"),
        e instanceof Error ? e.message : t("restore.downloadDecryptFailed"),
      );
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      <Text style={embedded ? styles.title : ui.title}>{title}</Text>
      <Text style={embedded ? styles.caption : ui.caption}>{caption}</Text>

      {!seedOnly ? (
        <View style={styles.seg}>
          {(["seed", "nsec", "server"] as Tab[]).map((tabKey) => (
            <Pressable
              key={tabKey}
              style={[styles.segBtn, tab === tabKey && styles.segOn]}
              onPress={() => setTab(tabKey)}
            >
              <Text style={[styles.segText, tab === tabKey && styles.segTextOn]}>
                {tabKey === "seed"
                  ? t("restore.tabSeed")
                  : tabKey === "nsec"
                    ? t("restore.tabNsec")
                    : t("restore.tabServer")}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {seedOnly || tab === "seed" ? (
        <>
          <Text style={styles.label}>{t("restore.seedLabel")}</Text>
          <TextInput
            style={[styles.input, { minHeight: 100 }]}
            value={seed}
            onChangeText={setSeed}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t("restore.seedPlaceholder")}
            placeholderTextColor={colors.hint}
          />
          <Pressable
            style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => void onRestoreSeed()}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>
                {seedOnly && embedded
                  ? t("restore.importArkadeWallet")
                  : t("restore.restoreArkadeFromSeed")}
              </AdaptiveText>
            )}
          </Pressable>
        </>
      ) : null}

      {!seedOnly && tab === "nsec" ? (
        <>
          <Text style={[ui.hint, { marginTop: 8, marginBottom: 4 }]}>
            {t("restore.nsecHint")}
          </Text>
          <Text style={styles.label}>{t("restore.nsecLabel")}</Text>
          <TextInput
            style={[styles.input, styles.nsecInput]}
            value={nsec}
            onChangeText={setNsec}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            textContentType="none"
            secureTextEntry={false}
            multiline
            placeholder={t("restore.nsecPlaceholder")}
            placeholderTextColor={colors.hint}
          />
          <Text style={[ui.hint, { marginTop: 6 }]}>
            {t("restore.nsecMustStart")}
          </Text>
          <Text style={styles.label}>{t("restore.passphraseRequiredLabel")}</Text>
          <PassphraseInput
            value={passphrase}
            onChangeText={setPassphrase}
            placeholder="••••••••••••"
          />
          <Text style={[ui.hint, { marginTop: 12 }]}>{t("restore.passphraseLossCaption")}</Text>
          <Pressable
            style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => void onRestoreNsec()}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>{t("restore.restorePackage")}</AdaptiveText>
            )}
          </Pressable>
        </>
      ) : null}

      {!seedOnly && tab === "server" ? (
        <>
          <Text style={[ui.hint, { marginTop: 8 }]}>
            {t("restore.serverHint")}
          </Text>
          <Text style={styles.label}>{t("restore.serverUrlLabel")}</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            placeholder={t("restore.serverUrlPlaceholder")}
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>{t("restore.usernameLabel")}</Text>
          <TextInput
            style={styles.input}
            value={serverUser}
            onChangeText={setServerUser}
            autoCapitalize="none"
            placeholder={t("restore.usernamePlaceholder")}
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>{t("restore.appPasswordLabel")}</Text>
          <TextInput
            style={styles.input}
            value={serverAppPassword}
            onChangeText={setServerAppPassword}
            autoCapitalize="none"
            secureTextEntry
            placeholder={t("restore.appPasswordPlaceholder")}
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>{t("restore.orBearerLabel")}</Text>
          <TextInput
            style={styles.input}
            value={serverToken}
            onChangeText={setServerToken}
            autoCapitalize="none"
            secureTextEntry
            placeholder={t("restore.optionalPlaceholder")}
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>{t("restore.nsecLabel")}</Text>
          <TextInput
            style={[styles.input, styles.nsecInput]}
            value={nsec}
            onChangeText={setNsec}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder={t("restore.nsecPlaceholder")}
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>{t("restore.passphraseRequiredLabel")}</Text>
          <PassphraseInput
            value={passphrase}
            onChangeText={setPassphrase}
            placeholder="••••••••••••"
          />
          <Text style={[ui.hint, { marginTop: 12 }]}>{t("restore.passphraseLossCaption")}</Text>
          <Pressable
            style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => void onRestoreServer()}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <AdaptiveText style={ui.primaryBtnText} baseFontSize={15}>{t("restore.restoreFromServer")}</AdaptiveText>
            )}
          </Pressable>
        </>
      ) : null}

      {!hasWallet && !seedOnly && onCreateInstead ? (
        <Text style={ui.footerLink} onPress={onCreateInstead}>
          {t("restore.createInstead")}
        </Text>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <ScrollView
        style={styles.embedRoot}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        {body}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  embedRoot: { flex: 1 },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
    marginTop: 4,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 8,
    lineHeight: 18,
  },
  seg: {
    flexDirection: "row",
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#555",
    padding: 4,
    marginTop: 16,
    marginBottom: 8,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  segOn: { backgroundColor: colors.fg },
  segText: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
  segTextOn: {
    color: "#000",
    fontFamily: "JetBrainsMono_700Bold",
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
    textAlignVertical: "top",
  },
  nsecInput: {
    minHeight: 88,
  },
});
