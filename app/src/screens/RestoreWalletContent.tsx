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
  PASSPHRASE_LOSS_CAPTION,
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
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { createHdWalletFromMnemonic } from "../wallet/hdWallet";
import { setMnemonicSource } from "../wallet/mnemonicMeta";
import { useWallet } from "../wallet/WalletProvider";

type Tab = "seed" | "nsec" | "server";

const CAPTION_SEED_ONLY =
  "Imports one Arkade wallet from a BIP39 seed.";

const CAPTION_SEED_PASSKEY_NOTE =
  "\n\nA passkey alone is not enough to recover imported wallets after a fresh install. " +
  "Use seed export, Nostr package, or home server for those wallets.";

const CAPTION_FULL =
  "Restore with seed imports just a single Arkade wallet.\n" +
  "With nsec and Server options you can restore encrypted\n" +
  "packages with multiple wallets.";

const CAPTION_FULL_PASSKEY_NOTE =
  "\n\nA passkey alone does not restore non-PRF wallets after a fresh install. " +
  "Prefer one of the backup methods below.";

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

  const title = useMemo(() => (seedOnly ? "IMPORT WALLET" : "RESTORE"), [seedOnly]);
  const caption = useMemo(() => {
    if (seedOnly) {
      return CAPTION_SEED_ONLY + (passkeyInstall ? CAPTION_SEED_PASSKEY_NOTE : "");
    }
    return CAPTION_FULL + (passkeyInstall ? CAPTION_FULL_PASSKEY_NOTE : "");
  }, [passkeyInstall, seedOnly]);

  async function onRestoreSeed() {
    const words = seed.trim().split(/\s+/).filter(Boolean);
    if (words.length !== 12 && words.length !== 24) {
      Alert.alert("Invalid phrase", "Enter 12 or 24 BIP39 words.");
      return;
    }
    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm to restore Arkade wallet");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Wallet was not restored.");
        return;
      }
      await setMnemonicSource("device-only");
      const networkId = getNetworkConfig().id;
      const label = hasWallet ? "Restored" : "Personal";
      const record = insertWallet(networkId, {
        kind: "arkade",
        label,
        tag: hasWallet ? null : "main",
      });
      await createHdWalletFromMnemonic(record.id, words.join(" "));
      setSelectedWalletId(networkId, record.id);
      beginQuietImportSync();
      await selectWallet(record.id);
      Alert.alert("Restored", "Arkade wallet imported.");
      onDone(seedOnly || hasWallet ? "Home" : "Ready");
    } catch (e) {
      Alert.alert("Restore failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function onRestoreNsec() {
    if (!nsec.trim()) {
      Alert.alert("Required", "nsec is required.");
      return;
    }
    if (!passphrase) {
      Alert.alert("Required", "Backup passphrase is required.");
      return;
    }
    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm to restore from Nostr package");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Package was not restored.");
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
          "Identity imported",
          "No encrypted package on this device or relays. Use Seed for one Arkade wallet, or enable backup after create.",
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
            label: entry.label || (i === 0 ? "Personal" : `Wallet ${i + 1}`),
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
        "Restored",
        `${pkg.wallets.length} wallet(s): ${labels}` +
          (notesRestored ? `\n${notesRestored} note(s)` : "") +
          (contactsRestored ? `\n${contactsRestored} contact(s)` : "") +
          (prefsRestored ? `\n${prefsRestored} Fiat/Maxi pref(s)` : "") +
          ".",
      );
      onDone("Ready");
    } catch (e) {
      Alert.alert(
        "Restore failed",
        e instanceof Error ? e.message : "Wrong passphrase or corrupt package",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRestoreServer() {
    if (!serverUrl.trim()) {
      Alert.alert("Required", "Enter the home server / Nextcloud URL.");
      return;
    }
    const creds = {
      token: serverToken.trim() || null,
      username: serverUser.trim() || null,
      password: serverAppPassword.trim() || null,
    };
    if (!homeCredsHaveAuth(creds)) {
      Alert.alert(
        "Credentials required",
        "Enter username + application password, or a Bearer access token.",
      );
      return;
    }
    if (!nsec.trim()) {
      Alert.alert("Required", "nsec is required to unwrap the package.");
      return;
    }
    if (!passphrase) {
      Alert.alert("Required", "Backup passphrase is required.");
      return;
    }

    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm to restore from home server");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Package was not restored.");
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
            label: entry.label || (i === 0 ? "Personal" : `Wallet ${i + 1}`),
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
        "Restored",
        `${pkg.wallets.length} wallet(s): ${labels}` +
          (notesRestored ? `\n${notesRestored} note(s)` : "") +
          (contactsRestored ? `\n${contactsRestored} contact(s)` : "") +
          (prefsRestored ? `\n${prefsRestored} Fiat/Maxi pref(s)` : "") +
          ".",
      );
      onDone("Ready");
    } catch (e) {
      Alert.alert(
        "Restore failed",
        e instanceof Error ? e.message : "Download or decrypt failed",
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
          {(["seed", "nsec", "server"] as Tab[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.segBtn, tab === t && styles.segOn]}
              onPress={() => setTab(t)}
            >
              <Text style={[styles.segText, tab === t && styles.segTextOn]}>
                {t === "seed" ? "Seed" : t === "nsec" ? "nsec" : "Server"}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {seedOnly || tab === "seed" ? (
        <>
          <Text style={styles.label}>Arkade recovery phrase</Text>
          <TextInput
            style={[styles.input, { minHeight: 100 }]}
            value={seed}
            onChangeText={setSeed}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="12 or 24 words…"
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
              <Text style={ui.primaryBtnText}>
                {seedOnly ? "Import Arkade wallet" : "Restore Arkade from seed"}
              </Text>
            )}
          </Pressable>
        </>
      ) : null}

      {!seedOnly && tab === "nsec" ? (
        <>
          <Text style={[ui.hint, { marginTop: 8, marginBottom: 4 }]}>
            Multi-wallet encrypted package. Passphrase always required.
          </Text>
          <Text style={styles.label}>nsec</Text>
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
            placeholder="nsec1…"
            placeholderTextColor={colors.hint}
          />
          <Text style={[ui.hint, { marginTop: 6 }]}>
            Must start with nsec1… (not npub). Export it before Reset if you have not already.
          </Text>
          <Text style={styles.label}>backup passphrase · required</Text>
          <PassphraseInput
            value={passphrase}
            onChangeText={setPassphrase}
            placeholder="••••••••••••"
          />
          <Text style={[ui.hint, { marginTop: 12 }]}>{PASSPHRASE_LOSS_CAPTION}</Text>
          <Pressable
            style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => void onRestoreNsec()}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={ui.primaryBtnText}>Restore package</Text>
            )}
          </Pressable>
        </>
      ) : null}

      {!seedOnly && tab === "server" ? (
        <>
          <Text style={[ui.hint, { marginTop: 8 }]}>
            Download the encrypted package via WebDAV (Nextcloud) or Bearer token, then unwrap with nsec + passphrase.
          </Text>
          <Text style={styles.label}>server URL</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            autoCapitalize="none"
            placeholder="https://nextcloud.example"
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>username</Text>
          <TextInput
            style={styles.input}
            value={serverUser}
            onChangeText={setServerUser}
            autoCapitalize="none"
            placeholder="Nextcloud user"
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>application password</Text>
          <TextInput
            style={styles.input}
            value={serverAppPassword}
            onChangeText={setServerAppPassword}
            autoCapitalize="none"
            secureTextEntry
            placeholder="app password"
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>or Bearer token</Text>
          <TextInput
            style={styles.input}
            value={serverToken}
            onChangeText={setServerToken}
            autoCapitalize="none"
            secureTextEntry
            placeholder="optional"
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>nsec</Text>
          <TextInput
            style={[styles.input, styles.nsecInput]}
            value={nsec}
            onChangeText={setNsec}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            placeholder="nsec1…"
            placeholderTextColor={colors.hint}
          />
          <Text style={styles.label}>backup passphrase · required</Text>
          <PassphraseInput
            value={passphrase}
            onChangeText={setPassphrase}
            placeholder="••••••••••••"
          />
          <Text style={[ui.hint, { marginTop: 12 }]}>{PASSPHRASE_LOSS_CAPTION}</Text>
          <Pressable
            style={[ui.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => void onRestoreServer()}
          >
            {busy ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={ui.primaryBtnText}>Restore from server</Text>
            )}
          </Pressable>
        </>
      ) : null}

      {!hasWallet && !seedOnly && onCreateInstead ? (
        <Text style={ui.footerLink} onPress={onCreateInstead}>
          Create a new wallet instead
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
