/**
 * Full-screen converting overlay for Fiat Mode swaps (no cancel during convert).
 */

import { ActivityIndicator, Modal, StyleSheet, Text, View } from "react-native";
import { AdaptiveText, useI18n } from "../i18n";
import { colors } from "../theme/colors";
import { useFiatMode } from "./FiatModeProvider";

export function FiatModeConvertingOverlay() {
  const { t } = useI18n();
  const { converting, convertingMessage } = useFiatMode();
  if (!converting) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <ActivityIndicator color="#fff" size="large" />
          <AdaptiveText style={styles.title} baseFontSize={16}>
            {t("fiat.overlayTitle")}
          </AdaptiveText>
          <Text style={styles.msg}>
            {convertingMessage || t("fiat.pleaseWait")}
          </Text>
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
});
