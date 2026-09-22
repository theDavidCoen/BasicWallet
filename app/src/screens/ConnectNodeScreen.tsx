/**
 * Connect Node hub — stack page for provider pick (rarely used).
 * Preferred entry: Add Wallet → Connect Lightning Node (sheet).
 * Settings → Connected node uses ConnectedNodeScreen (status only).
 */

import { useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { ConnectNodeSheetContent } from "./ConnectNodeSheetContent";

export function ConnectNodeScreen() {
  const navigation = useNavigation<RootNav>();

  return (
    <ScreenChrome logoScale={0.77}>
      <ConnectNodeSheetContent
        onSelect={(dest) => {
          navigation.navigate(dest === "lndhub" ? "ConnectLndHub" : "ConnectBtcPay");
        }}
      />
    </ScreenChrome>
  );
}
