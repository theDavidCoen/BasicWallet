import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import {
  Button,
  Caption,
  EmptyStateCard,
  ScreenTitle,
  TextField,
} from "../components/ui";
import { syncContactsDirectoryNow } from "../contacts/contactsNostrSync";
import { importAndStoreNsec } from "../nostr/identityStore";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { fonts } from "../theme/typography";

/** Gate then paste nsec. */
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
      // Owner binding for Ask Cursor must stay 1:1 — wipe bot on identity change.
      try {
        const { wipeCursorBotForReset } = await import("../agent/activateBot");
        await wipeCursorBotForReset();
      } catch {
        /* */
      }
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
          <ScreenTitle>IMPORT NSEC</ScreenTitle>
          <Caption>
            {"Sets the Nostr identity on this device:\n" +
              "social profile, contacts, and wallet names\n" +
              "under that key. It is not your wallet seed."}
          </Caption>

          <EmptyStateCard variant="muted">
            {[
              "Passkey users: import does not replace or back up passkey wallets.",
              "Continue with passkey brings those wallets back and restores the passkey Nostr key.",
              "Import alone is not a Nostr or Home backup. Turn on Backup in Settings if you need an encrypted login package.",
              "If you import another nsec and never enable Backup, contacts and labels under that key will not come back with passkey alone.",
              "Clipboard / screenshot risk on paste.",
            ].map((line) => (
              <Caption
                key={line}
                align="left"
                style={{ textAlign: "left", marginBottom: 10 }}
              >
                {`· ${line}`}
              </Caption>
            ))}
          </EmptyStateCard>

          <Button onPress={() => setUnderstood(true)}>I understand · Continue</Button>

          <Button
            variant="secondary"
            onPress={() => navigation.navigate("GenerateIdentityWarning")}
          >
            Generate new identity instead
          </Button>
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
        <ScreenTitle>PASTE NSEC</ScreenTitle>
        <Caption>nsec1… or 64-char hex. Never share this screen.</Caption>

        <Text style={styles.label}>nsec</Text>
        <TextField
          style={styles.input}
          value={nsec}
          onChangeText={setNsec}
          placeholder="nsec1…"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          multiline
        />

        <Button
          busy={busy}
          disabled={!nsec.trim()}
          onPress={() => void onImport()}
        >
          Import nsec
        </Button>
      </ScrollView>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.hint,
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    minHeight: 88,
    fontSize: 13,
    textAlignVertical: "top",
    marginBottom: 0,
  },
});
