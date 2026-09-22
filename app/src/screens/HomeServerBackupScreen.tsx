import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
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
import { mnemonicFromEntropy, randomEntropy32 } from "../onboarding/mnemonicFromEntropy";
import {
  enableEncryptedBackup,
  PASSPHRASE_LOSS_CAPTION,
  readCipherBlob,
} from "../nostr/backupPackage";
import { BACKUP_PASSPHRASE_HINT, BACKUP_PASSPHRASE_RULES, validateBackupPassphrase } from "../nostr/passphrasePolicy";
import { ensureNostrIdentity, hasNostrIdentity } from "../nostr/identityStore";
import { homeCredsHaveAuth } from "../nostr/homeServerCreds";
import { uploadHomeBackupCipher } from "../nostr/homeServerWebdav";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";
import { PassphraseInput } from "../components/PassphraseInput";

/** Penpot 12e — home server channel (WebDAV / Nextcloud + optional Bearer token). */
export function HomeServerBackupScreen() {
  const navigation = useNavigation<RootNav>();
  const { hasWallet, provisionFromMnemonic } = useWallet();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const wasEmpty = !hasWallet;

  async function onEnable() {
    if (!url.trim()) {
      Alert.alert("Server URL required", "Enter your home server or Nextcloud URL.");
      return;
    }
    const creds = {
      token: token.trim() || null,
      username: username.trim() || null,
      password: appPassword.trim() || null,
    };
    if (!homeCredsHaveAuth(creds)) {
      Alert.alert(
        "Credentials required",
        "Enter a Bearer access token, or a Nextcloud username + application password.",
      );
      return;
    }
    if (creds.username && !creds.password) {
      Alert.alert("App password required", "Nextcloud needs an application password with the username.");
      return;
    }
    if (creds.password && !creds.username) {
      Alert.alert("Username required", "Enter your Nextcloud username with the application password.");
      return;
    }

    const check = validateBackupPassphrase(passphrase);
    if (!check.ok) {
      Alert.alert("Invalid passphrase", check.message);
      return;
    }

    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm to enable home server backup");
      if (!auth.ok) {
        Alert.alert("Authentication required", "Backup was not enabled.");
        return;
      }

      if (!(await hasNostrIdentity())) {
        await ensureNostrIdentity();
      }

      if (!hasWallet) {
        const mnemonic = mnemonicFromEntropy(await randomEntropy32());
        await provisionFromMnemonic(mnemonic, "device-only");
      }

      await ensureNostrIdentity();
      const meta = await enableEncryptedBackup({
        channel: "home",
        passphrase,
        homeUrl: url,
        homeToken: creds.token,
        homeUser: creds.username,
        homePassword: creds.password,
      });

      const blob = await readCipherBlob();
      if (!blob) throw new Error("Local backup package missing after enable");
      const { fileUrl } = await uploadHomeBackupCipher(url, blob, creds);

      Alert.alert(
        "Home backup enabled",
        `${meta.walletCount} wallet(s) uploaded to\n${fileUrl}`,
      );

      if (wasEmpty) {
        navigation.reset({ index: 0, routes: [{ name: "Ready" }] });
      } else {
        navigation.navigate("AdvancedBackup");
      }
    } catch (e) {
      Alert.alert("Could not enable backup", e instanceof Error ? e.message : "Unknown error");
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
        <Text style={ui.title}>HOME SERVER</Text>
        <Text style={ui.caption}>
          Same encrypted package as Nostr.{"\n"}
          Nextcloud WebDAV or Bearer token.{"\n"}
          Passphrase required.
        </Text>

        <Text style={styles.label}>server URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://nextcloud.example"
          placeholderTextColor={colors.hint}
        />
        <Text style={[ui.hint, { marginTop: 6 }]}>
          Origin is enough for Nextcloud (we append remote.php/dav/…). Or paste a full WebDAV file URL.
        </Text>

        <Text style={[styles.section, { marginTop: 20 }]}>Nextcloud / WebDAV</Text>
        <Text style={styles.label}>username</Text>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="username"
          placeholderTextColor={colors.hint}
        />
        <Text style={styles.label}>application password</Text>
        <TextInput
          style={styles.input}
          value={appPassword}
          onChangeText={setAppPassword}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Nextcloud app password"
          placeholderTextColor={colors.hint}
          secureTextEntry
        />

        <Text style={[styles.section, { marginTop: 20 }]}>Or access token</Text>
        <Text style={styles.label}>Bearer token</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="optional if using username + app password"
          placeholderTextColor={colors.hint}
          secureTextEntry
        />

        <Text style={styles.label}>backup passphrase</Text>
        <PassphraseInput
          value={passphrase}
          onChangeText={setPassphrase}
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
            <Text style={ui.primaryBtnText}>Enable home backup</Text>
          )}
        </Pressable>
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
