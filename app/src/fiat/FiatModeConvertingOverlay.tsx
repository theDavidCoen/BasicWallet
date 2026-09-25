/**
 * Full-screen converting overlay + Cancel for Fiat Mode swaps.
 */

import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme/colors";
import { useFiatMode } from "./FiatModeProvider";

export function FiatModeConvertingOverlay() {
  const { converting, convertingMessage, cancelConverting } = useFiatMode();
  if (!converting) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.title}>CONVERTING</Text>
          <Text style={styles.msg}>{convertingMessage || "Please wait…"}</Text>
          <Pressable style={styles.cancel} onPress={cancelConverting}>
            <Text style={styles.cancelLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontFamily: "JetBrainsMono_700Bold",
    fontSize: 16,
    color: colors.fg,
    letterSpacing: 1,
  },
  msg: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 12,
    color: colors.hint,
    textAlign: "center",
  },
  cancel: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  cancelLabel: {
    fontFamily: "JetBrainsMono_400Regular",
    fontSize: 13,
    color: colors.fg,
  },
});
