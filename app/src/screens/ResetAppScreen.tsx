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
import { factoryResetWipeDevice } from "../security/appReset";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

const CONFIRM_PHRASE = "Reset";

/**
 * Settings → Reset app. Type “Reset” + biometrics → wipe → onboarding.
 */
export function ResetAppScreen() {
  const navigation = useNavigation<RootNav>();
  const { applyFactoryReset } = useWallet();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const phraseOk = typed.trim() === CONFIRM_PHRASE;

  async function onConfirm() {
    if (!phraseOk) {
      Alert.alert("Type Reset", `Type exactly “${CONFIRM_PHRASE}” to continue.`);
      return;
    }

    setBusy(true);
    try {
      const auth = await requireUserPresence("Confirm factory reset");
      if (!auth.ok) {
        Alert.alert("Authentication required", "App was not reset.");
        return;
      }

      await factoryResetWipeDevice();
      await applyFactoryReset();

      navigation.reset({ index: 0, routes: [{ name: "OnboardingCreate" }] });
    } catch (e) {
      Alert.alert("Reset failed", e instanceof Error ? e.message : "Unknown error");
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
        <Text style={ui.title}>RESET APP</Text>
        <Text style={ui.caption}>
          Permanently clears this device’s wallet data{"\n"}and returns you to onboarding.
        </Text>

        <View style={ui.cardMuted}>
          {[
            "All seeds on this device are deleted",
            "Nostr identity (nsec) is forgotten from Keystore",
            "Without your own nsec backup, any Nostr relay package becomes unrecoverable",
            "Local encrypted backup package is kept on this device (needs nsec + passphrase to open)",
            "Activity history and wallet list are wiped",
            "Transaction notes stay in the local database until you uninstall the app",
            "You will land on the create / restore onboarding screen",
            "Passkey link on this device is cleared — Continue with passkey asks your password manager to pick an existing key (never silent create)",
            "Passkey child wallet labels are kept so labeled wallets rematerialize from the same PRF",
            "Any wallets not in the passkey tree will be removed (restore them from a Nostr / home backup)",
          ].map((line) => (
            <Text key={line} style={[ui.caption, { textAlign: "left", marginBottom: 10 }]}>
              · {line}
            </Text>
          ))}
        </View>

        <Text style={[ui.hint, { marginTop: 16 }]}>
          This cannot be undone without a seed, passkey, or{"\n"}
          encrypted package plus nsec and passphrase.
        </Text>

        <Text style={styles.label}>Type Reset to confirm</Text>
        <TextInput
          style={styles.input}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Reset"
          placeholderTextColor={colors.hint}
          editable={!busy}
        />

        <Pressable
          style={[ui.primaryBtn, (!phraseOk || busy) && { opacity: 0.5 }]}
          disabled={!phraseOk || busy}
          onPress={() => void onConfirm()}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={ui.primaryBtnText}>Reset app</Text>
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
    marginTop: 24,
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
    fontSize: 16,
  },
});
