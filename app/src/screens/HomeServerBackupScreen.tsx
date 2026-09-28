import { useNavigation } from "@react-navigation/native";
import { useMemo, useState } from "react";
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
import { BACKUP_PASSPHRASE_HINT } from "../nostr/passphrasePolicy";
import { backupPassphraseChecklist, validateBackupPassphrase } from "../nostr/passphrasePolicy";
import { homeCredsHaveAuth } from "../nostr/homeServerCreds";
import { ensureNostrIdentity, hasNostrIdentity } from "../nostr/identityStore";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

/** Penpot 12e — home server channel; Next → Backup Recap (enable there). */
export function HomeServerBackupScreen() {
  const navigation = useNavigation<RootNav>();
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const checklist = useMemo(
    () => backupPassphraseChecklist(passphrase, confirm),
    [passphrase, confirm],
  );

  async function onNext() {
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
    if (passphrase !== confirm) {
      Alert.alert("Mismatch", "Passphrase and confirmation do not match.");
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
        "Could not continue",
        e instanceof Error ? e.message : "Unknown error",
      );
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
          Nextcloud WebDAV or Bearer token.
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
