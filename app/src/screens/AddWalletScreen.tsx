/**
 * Add Wallet full screen — redirects into the sheet host when mounted from stack.
 * Prefer opening via useSheets().openAddWallet().
 */

import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { useSheets } from "../navigation/SheetHost";
import { colors } from "../theme/colors";

export function AddWalletScreen() {
  const navigation = useNavigation<RootNav>();
  const { openAddWallet } = useSheets();

  useEffect(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate("Home");
    }
    requestAnimationFrame(() => openAddWallet());
  }, [navigation, openAddWallet]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.fg} />
    </View>
  );
}
