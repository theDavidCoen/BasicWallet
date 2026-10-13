import { useNavigation } from "@react-navigation/native";
import { useEffect } from "react";
import { View } from "react-native";
import type { RootNav } from "../navigation/types";
import { Caption, Hint, ScreenTitle } from "../components/ui";
import { useI18n } from "../i18n";
import { armHomeTourIfNeeded } from "../home/homeTour";
import { markWarmupSeen } from "../wallet/warmupSeen";
import { ui } from "../theme/ui";

export function ReadyScreen() {
  const navigation = useNavigation<RootNav>();
  const { t } = useI18n();

  useEffect(() => {
    // Next cold start should say WELCOME BACK, not SETTING UP.
    void markWarmupSeen();
    let cancelled = false;
    void (async () => {
      // Arm sync latch BEFORE Home mounts — no window where POS/QR are free.
      await armHomeTourIfNeeded();
      if (cancelled) return;
      // Brief Ready beat, then Home (tour Modal opens on first paint via latch).
      await new Promise((r) => setTimeout(r, 200));
      if (cancelled) return;
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigation]);

  return (
    <View style={ui.centerRoot}>
      <ScreenTitle>{t("onboarding.readyTitle")}</ScreenTitle>
      <Caption>{t("onboarding.readyCaption")}</Caption>
      <Hint style={{ marginTop: 24 }}>{t("onboarding.readyOpening")}</Hint>
    </View>
  );
}
