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
    <InteractiveBottomSheet open={open} onDismiss={onDismiss} visibleFraction={0.55} avoidKeyboard>
      <View style={styles.body}>
        <Text style={styles.title}>SHARE CONTACT</Text>
        <Text style={styles.caption} numberOfLines={2}>
          {contactDisplayName(contact)}
        </Text>
        <Text style={styles.hint}>
          Send an encrypted Nostr gift wrap to another Basic Wallet. Enter their npub or NIP-05.
        </Text>

        <Text style={styles.label}>npub or NIP-05</Text>
        <TextInput
          value={recipient}
          onChangeText={setRecipient}
          placeholder="npub1… or name@domain"
          placeholderTextColor={colors.hint}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          style={styles.input}
        />

        <Pressable
          style={[styles.primary, (!recipient.trim() || busy) && { opacity: 0.5 }]}
          disabled={!recipient.trim() || busy}
          onPress={() => void onSend()}
          accessibilityRole="button"
          accessibilityLabel="Send contact"
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.primaryText}>Send</Text>
          )}
        </Pressable>
      </View>
    </InteractiveBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 8,
  },
  caption: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginBottom: 10,
  },
  hint: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
    lineHeight: 17,
    marginBottom: 18,
  },
  label: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.caption,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.fg,
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 14,
    marginBottom: 16,
  },
  primary: {
    backgroundColor: colors.fg,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 15,
    color: "#000",
  },
});
