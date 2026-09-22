/**
 * LNDHub connect — full stack page (Settings flow).
 * Switcher path uses ConnectLndHubSheetContent inside the Connect sheet.
 */

import { useNavigation } from "@react-navigation/native";
import type { RootNav } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { ConnectLndHubSheetContent } from "./ConnectLndHubSheetContent";

export function ConnectLndHubScreen() {
  const navigation = useNavigation<RootNav>();

  return (
    <ScreenChrome logoScale={0.77}>
      <ConnectLndHubSheetContent
        open
        onConnected={(payload) => {
          navigation.replace("NodeStatus", payload);
        }}
      />
    </ScreenChrome>
  );
}
