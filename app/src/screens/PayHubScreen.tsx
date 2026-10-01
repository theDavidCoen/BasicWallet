/**
 * Chat & Pay hub (Penpot 15g). Stub: empty state until threads ship.
 * Entry: Home CTA + Settings → Chat & Pay.
 */

import { useNavigation } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";

export function PayHubScreen() {
  const navigation = useNavigation<RootNav>();

  return (
    <ScreenChrome logoScale={0.77}>
      <Text style={ui.title}>CHAT & PAY</Text>
      <Text style={ui.caption}>
        Private chats with contacts. Encrypted with your account data.
      </Text>

      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>No chats yet</Text>
        <Text style={styles.emptyBody}>
          Open a contact to start a private payment chat. Text, requests, and
          payments will live in one thread.
        </Text>
      </View>

      <Pressable
        style={ui.secondaryBtn}
        onPress={() => navigation.navigate("Contacts", { selectForChat: true })}
        accessibilityRole="button"
        accessibilityLabel="Open contacts"
      >
        <Text style={ui.secondaryBtnText}>Open contacts</Text>
      </Pressable>
    </ScreenChrome>
  );
}

const styles = StyleSheet.create({
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginTop: 28,
  },
  emptyTitle: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    textAlign: "center",
    marginBottom: 10,
  },
  emptyBody: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.caption,
    textAlign: "center",
    lineHeight: 20,
  },
});
