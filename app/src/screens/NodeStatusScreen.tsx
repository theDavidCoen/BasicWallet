/**
 * Node Status — full stack page after connect (rare stack path).
 * Switcher path uses NodeStatusSheetContent inside the Connect sheet.
 */

import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { ScreenChrome } from "../components/ScreenChrome";
import { NodeStatusSheetContent } from "./NodeStatusSheetContent";

export function NodeStatusScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "NodeStatus">>();
  const payload = route.params ?? {};

  return (
    <ScreenChrome logoScale={0.77}>
      <NodeStatusSheetContent
        payload={payload}
        onDone={() => navigation.navigate("Home")}
      />
    </ScreenChrome>
  );
}
