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
  View,
} from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { syncContactsDirectoryNow } from "../contacts/contactsNostrSync";
import { importAndStoreNsec } from "../nostr/identityStore";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

/** Penpot 12f + import form — gate then paste nsec. */
export function ImportNsecWarningScreen() {
  const navigation = useNavigation<RootNav>();
  const [understood, setUnderstood] = useState(false);
  const [nsec, setNsec] = useState("");
  const [busy, setBusy] = useState(false);

  async function onImport() {
    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm to import nsec");
      if (!auth.ok) {
        Alert.alert("Authentication required", "nsec was not imported.");
        return;
      }
      await importAndStoreNsec(nsec);
      const applied = await syncContactsDirectoryNow("nsec-import");
      setNsec("");
      Alert.alert(
        "Imported",
        applied?.length
          ? `Nostr identity updated. Restored ${applied.length} contact(s) from relays.`
          : "Nostr identity updated. Open Contacts when online to pull the directory.",
      );
      navigation.navigate("NostrIdentity");
    } catch (e) {
      Alert.alert("Import failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  if (!understood) {
    return (
      <ScreenChrome logoScale={0.77}>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <Text style={ui.title}>IMPORT NSEC</Text>
          <Text style={ui.caption}>
            Sets the Nostr identity on this device:{"\n"}
            social profile, contacts, and wallet names{"\n"}
            under that key. It is not your wallet seed.
          </Text>

          <View style={ui.cardMuted}>
            {[
              "Passkey users: import does not replace or back up passkey wallets.",
              "Continue with passkey brings those wallets back and restores the passkey Nostr key.",
              "Import alone is not a Nostr or Home backup. Turn on Backup in Settings if you need an encrypted login package.",
              "If you import another nsec and never enable Backup, contacts and labels under that key will not come back with passkey alone.",
              "Clipboard / screenshot risk on paste.",
            ].map((line) => (
              <Text key={line} style={[ui.caption, { textAlign: "left", marginBottom: 10 }]}>
                · {line}
              </Text>
            ))}
          </View>

          <Pressable style={ui.primaryBtn} onPress={() => setUnderstood(true)}>
            <Text style={ui.primaryBtnText}>I understand · Continue</Text>
          </Pressable>

          <Pressable
            style={ui.secondaryBtn}
            onPress={() => navigation.navigate("GenerateIdentityWarning")}
          >
            <Text style={ui.secondaryBtnText}>Generate new identity instead</Text>
          </Pressable>
        </ScrollView>
      </ScreenChrome>
    );
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={ui.title}>PASTE NSEC</Text>
        <Text style={ui.caption}>nsec1… or 64-char hex. Never share this screen.</Text>

        <Text style={styles.label}>nsec</Text>
        <TextInput
          style={styles.input}
          value={nsec}
          onChangeText={setNsec}
          placeholder="nsec1…"
          placeholderTextColor={colors.hint}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          multiline
        />

        <Pressable
          style={[ui.primaryBtn, (busy || !nsec.trim()) && { opacity: 0.6 }]}
          disabled={busy || !nsec.trim()}
          onPress={() => void onImport()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={ui.primaryBtnText}>Import nsec</Text>
          )}
        </Pressable>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    textAlignVertical: "top",
  },
});
