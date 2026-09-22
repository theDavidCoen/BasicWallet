import { useNavigation } from "@react-navigation/native";
import { useEffect } from "react";
import { Text, View } from "react-native";
import type { RootNav } from "../navigation/types";
import { ui } from "../theme/ui";

export function ReadyScreen() {
  const navigation = useNavigation<RootNav>();

  useEffect(() => {
    const t = setTimeout(() => {
      navigation.reset({ index: 0, routes: [{ name: "Home" }] });
    }, 600);
    return () => clearTimeout(t);
  }, [navigation]);

  return (
    <View style={ui.centerRoot}>
      <Text style={ui.title}>YOU'RE READY</Text>
      <Text style={ui.caption}>
        Wallet is ready to use.
      </Text>
      <Text style={[ui.hint, { marginTop: 24 }]}>Opening wallet…</Text>
    </View>
  );
}
