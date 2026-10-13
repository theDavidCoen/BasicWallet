/**
 * After Path C enable succeeds — brief beat, then Home.
 */

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect } from "react";
import { View } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { Caption, Hint, ScreenTitle } from "../components/ui";
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
    let cancelled = false;
    void (async () => {
      await armHomeTourIfNeeded();
      if (cancelled) return;
      await new Promise((r) => setTimeout(r, 2000));
      if (cancelled) return;
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={ui.centerRoot}>
      <ScreenTitle>{t("backup.successTitle")}</ScreenTitle>
      <Caption>{t("backup.successBody", { label })}</Caption>
      <Hint style={{ marginTop: 24 }}>{t("backup.openingHome")}</Hint>
    </View>
  );
}
