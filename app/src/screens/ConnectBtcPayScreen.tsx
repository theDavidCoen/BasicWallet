/**
 * BTCPay LND (REST) connect — full stack page (Settings flow).
 * Switcher path uses ConnectBtcPaySheetContent inside the Connect sheet.
 */

import { useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { ConnectBtcPaySheetContent } from "./ConnectBtcPaySheetContent";

export function ConnectBtcPayScreen() {
  const navigation = useNavigation<RootNav>();

  return (
    <ScreenChrome logoScale={0.77}>
      <ConnectBtcPaySheetContent
        open
        onConnected={(payload) => {
          navigation.replace("NodeStatus", payload);
        }}
      />
    </ScreenChrome>
  );
}
