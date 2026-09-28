/**
 * After Path C enable succeeds — brief beat, then Home.
 */

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { useEffect } from "react";
import { Text, View } from "react-native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { markWarmupSeen } from "../wallet/warmupSeen";
import { ui } from "../theme/ui";

export function BackupEnabledSuccessScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "BackupEnabledSuccess">>();
  const channel = route.params?.channel ?? "nostr";
  const label = channel === "home" ? "Home server backup" : "Nostr backup";

  useEffect(() => {
    void markWarmupSeen();
    const t = setTimeout(() => {
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    }, 2000);
    return () => clearTimeout(t);
  }, [navigation]);

  return (
    <View style={ui.centerRoot}>
      <Text style={ui.title}>BACKUP ENABLED</Text>
      <Text style={ui.caption}>
        {label} is on.{"\n"}
        Keep nsec and passphrase somewhere safe.
      </Text>
      <Text style={[ui.hint, { marginTop: 24 }]}>Opening Home…</Text>
    </View>
  );
}
