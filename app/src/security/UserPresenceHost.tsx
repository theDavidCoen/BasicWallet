import { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { UnlockPinPad } from "../screens/SetAppPinScreen";
import { colors } from "../theme/colors";
import {
  resolvePresencePin,
  subscribePresencePinRequest,
} from "./presencePinRequest";
import { grantAppUnlockFromPresence } from "./presencePrompt";

/**
 * Full-screen PIN confirm when requireUserPresence falls back to App PIN.
 * Mount once under AppLockGate (or beside it).
 */
export function UserPresenceHost() {
  const insets = useSafeAreaInsets();
  const [prompt, setPrompt] = useState<string | null>(null);

  useEffect(() => {
    return subscribePresencePinRequest((p) => {
      setPrompt(p?.promptMessage ?? null);
    });
  }, []);

  if (!prompt) return null;

  return (
    <Modal visible animationType="fade" transparent={false} onRequestClose={() => {
      resolvePresencePin({ ok: false, reason: "user_cancel" });
    }}>
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
          },
        ]}
      >
        <Text style={styles.title}>CONFIRM</Text>
        <Text style={styles.sub}>{prompt}</Text>
        <UnlockPinPad
          onSuccess={() => {
            grantAppUnlockFromPresence();
            resolvePresencePin({ ok: true });
          }}
          onCancel={() => {
            resolvePresencePin({ ok: false, reason: "user_cancel" });
          }}
          cancelLabel="Cancel"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 28,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 20,
    color: colors.fg,
    textAlign: "center",
  },
  sub: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 8,
    lineHeight: 18,
  },
});
