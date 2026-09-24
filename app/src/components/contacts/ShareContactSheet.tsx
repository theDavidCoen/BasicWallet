/**
 * Bottom sheet: share contact via Nostr (npub or NIP-05).
 */

import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { shareContactToRecipient } from "../../contacts/contactShare";
import type { Contact } from "../../contacts/types";
import { contactDisplayName, midEllipsis } from "../../contacts/types";
import { hasNostrIdentity } from "../../nostr/identityStore";
import { InteractiveBottomSheet } from "../sheet/InteractiveBottomSheet";
import { colors } from "../../theme/colors";
import { sheetUi } from "../../theme/sheetUi";

export function ShareContactSheet({
  open,
  onDismiss,
  contact,
}: {
  open: boolean;
  onDismiss: () => void;
  contact: Contact;
}) {
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setRecipient("");
      setBusy(false);
    }
  }, [open]);

  async function onSend() {
    const raw = recipient.trim();
    if (!raw) {
      Alert.alert("Recipient required", "Enter an npub or NIP-05 name@domain.");
      return;
    }
    if (!(await hasNostrIdentity())) {
      Alert.alert(
        "Nostr identity needed",
        "Create or import a Nostr identity in Settings before sharing contacts.",
      );
      return;
    }
    setBusy(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    try {
      const result = await shareContactToRecipient(contact, raw, { signal: ctrl.signal });
      Alert.alert(
        "Shared",
        `Sent “${contactDisplayName(contact)}” to ${midEllipsis(result.recipientNpub)} via Nostr.`,
      );
      onDismiss();
    } catch (e) {
      Alert.alert("Share failed", e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  return (
    <InteractiveBottomSheet
      open={open}
      onDismiss={onDismiss}
      visibleFraction={0.62}
      avoidKeyboard
      portal
    >
      <View style={styles.body}>
        <Text style={sheetUi.title}>SHARE CONTACT</Text>
        <Text style={sheetUi.caption} numberOfLines={2}>
          {contactDisplayName(contact)}
        </Text>
        <Text style={sheetUi.hint}>
          Send an encrypted Nostr gift wrap to another Basic Wallet. Enter their npub or NIP-05.
        </Text>

        <Text style={sheetUi.label}>npub or NIP-05</Text>
        <TextInput
          value={recipient}
          onChangeText={setRecipient}
          placeholder="npub1… or name@domain"
          placeholderTextColor={colors.hint}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          style={sheetUi.input}
        />

        <Pressable
          style={[sheetUi.primaryBtn, (!recipient.trim() || busy) && { opacity: 0.5 }]}
          disabled={!recipient.trim() || busy}
          onPress={() => void onSend()}
          accessibilityRole="button"
          accessibilityLabel="Send contact"
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={sheetUi.primaryBtnText}>Send</Text>
          )}
        </Pressable>
      </View>
    </InteractiveBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingBottom: 12,
  },
});
