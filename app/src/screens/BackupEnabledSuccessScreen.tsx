/**
 * After Path C enable succeeds — brief beat, then Home.
 */

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect } from "react";
import { Text, View } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { useI18n } from "../i18n";
import { armHomeTourIfNeeded } from "../home/homeTour";
import { markWarmupSeen } from "../wallet/warmupSeen";
import { ui } from "../theme/ui";

export function BackupEnabledSuccessScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "BackupEnabledSuccess">>();
  const { t } = useI18n();
  const channel = route.params?.channel ?? "nostr";
  const label =
    channel === "home" ? t("backup.successLabelHome") : t("backup.successLabelNostr");

  useEffect(() => {
    void markWarmupSeen();
    void armHomeTourIfNeeded();
    const timer = setTimeout(() => {
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    }, 2000);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={ui.centerRoot}>
      <Text style={ui.title}>{t("backup.successTitle")}</Text>
      <Text style={ui.caption}>{t("backup.successBody", { label })}</Text>
      <Text style={[ui.hint, { marginTop: 24 }]}>{t("backup.openingHome")}</Text>
    </View>
  );
}
