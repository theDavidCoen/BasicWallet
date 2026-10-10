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
import { Button, Caption, Hint, ScreenTitle, TextField } from "../components/ui";
import { useI18n } from "../i18n";
import { factoryResetWipeDevice } from "../security/appReset";
import { requireUserPresence } from "../security/userPresence";
import { colors } from "../theme/colors";
import { ui } from "../theme/ui";
import { useWallet } from "../wallet/WalletProvider";

/** Safety phrase stays English across locales (typed confirm). */
const CONFIRM_PHRASE = "Reset";

/**
 * Settings → Reset app. Type “Reset” + biometrics → wipe → onboarding.
 */
export function ResetAppScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();
  const { applyFactoryReset } = useWallet();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const phraseOk = typed.trim() === CONFIRM_PHRASE;
  const bullets = [
    t("reset.bullet1"),
    t("reset.bullet2"),
    t("reset.bullet3"),
    t("reset.bullet4"),
    t("reset.bullet5"),
    t("reset.bullet6"),
    t("reset.bullet7"),
    t("reset.bullet8"),
    t("reset.bullet9"),
    t("reset.bullet10"),
  ];

  async function onConfirm() {
    if (!phraseOk) {
      Alert.alert(t("reset.alertTypeTitle"), t("reset.alertTypeBody"));
      return;
    }

    setBusy(true);
    try {
      const auth = await requireUserPresence(t("reset.authPrompt"));
      if (!auth.ok) {
        Alert.alert(t("reset.authRequired"), t("reset.authNotReset"));
        return;
      }

      await factoryResetWipeDevice();
      await applyFactoryReset();

      navigation.reset({ index: 0, routes: [{ name: "OnboardingCreate" }] });
    } catch (e) {
      Alert.alert(
        t("reset.failedTitle"),
        e instanceof Error ? e.message : t("common.unknownError"),
      );
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
        <ScreenTitle>{t("reset.title")}</ScreenTitle>
        <Caption>{t("reset.caption")}</Caption>

        <View style={ui.cardMuted}>
          {bullets.map((line) => (
            <Text key={line} style={[ui.caption, { textAlign: "left", marginBottom: 10 }]}>
              · {line}
            </Text>
          ))}
        </View>

        <Hint style={{ marginTop: 16 }}>{t("reset.hint")}</Hint>

        <Text style={styles.label}>{t("reset.typeLabel")}</Text>
        <TextField
          style={{ marginBottom: 0 }}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t("reset.placeholder")}
          editable={!busy}
        />

        <Button
          busy={busy}
          disabled={!phraseOk}
          onPress={() => void onConfirm()}
        >
          {t("reset.confirmBtn")}
        </Button>
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
});
