import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Alert, ScrollView } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { Button, Caption, EmptyStateCard, ScreenTitle } from "../components/ui";
import { generateAndStoreNostrIdentity, hasNostrIdentity } from "../nostr/identityStore";
import { requireUserPresence } from "../security/userPresence";
import { getMnemonicSource } from "../wallet/mnemonicMeta";

/** Destroy/replace Nostr identity. */
export function GenerateIdentityWarningScreen() {
  const navigation = useNavigation<RootNav>();
  const [busy, setBusy] = useState(false);

  async function onGenerate() {
    setBusy(true);
    try {
      const source = await getMnemonicSource();
      if (source === "passkey-prf") {
        Alert.alert(
          "Passkey identity",
          "Your Nostr key is derived from your passkey. Generating a random nsec would break " +
            "label-directory restore. Continue with passkey again to restore the derived identity.",
        );
        return;
      }
      const exists = await hasNostrIdentity();
      const auth = await requireUserPresence(
        exists ? "Confirm to replace your Nostr identity" : "Confirm to create a Nostr identity",
      );
      if (!auth.ok) {
        Alert.alert("Authentication required", "Identity was not changed.");
        return;
      }
      await generateAndStoreNostrIdentity();
      // Owner binding for Ask Cursor must stay 1:1 — wipe bot on identity change.
      try {
        const { wipeCursorBotForReset } = await import("../agent/activateBot");
        await wipeCursorBotForReset();
      } catch {
        /* */
      }
      Alert.alert(
        "Identity ready",
        exists
          ? "New nsec stored. Previous encrypted packages will not decrypt with this key."
          : "New nsec stored in secure storage.",
      );
      navigation.navigate("NostrIdentity");
    } catch (e) {
      Alert.alert("Could not generate", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenChrome logoScale={0.77}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <ScreenTitle>NEW IDENTITY</ScreenTitle>
        <Caption>
          {"Generates a fresh nsec on this device.\n" +
            "Existing backups tied to the old key stay encrypted."}
        </Caption>

        <EmptyStateCard variant="muted">
          {[
            "Old nsec is overwritten locally",
            "Re-enable encrypted backup after",
            "Export the new nsec offline",
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

        <Button busy={busy} onPress={() => void onGenerate()}>
          Generate new identity
        </Button>
      </ScrollView>
    </ScreenChrome>
  );
}
