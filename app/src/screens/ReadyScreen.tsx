import { useNavigation } from "@react-navigation/native";
import { useEffect } from "react";
import { Text, View } from "react-native";
import type { RootNav } from "../navigation/types";
import { useI18n } from "../i18n";
import { markWarmupSeen } from "../wallet/warmupSeen";
import { ui } from "../theme/ui";

export function ReadyScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();

  useEffect(() => {
    // Next cold start should say WELCOME BACK, not SETTING UP.
    void markWarmupSeen();
    const timer = setTimeout(() => {
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    }, 600);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={ui.centerRoot}>
      <Text style={ui.title}>{t("onboarding.readyTitle")}</Text>
      <Text style={ui.caption}>{t("onboarding.readyCaption")}</Text>
      <Text style={[ui.hint, { marginTop: 24 }]}>{t("onboarding.readyOpening")}</Text>
    </View>
  );
}
