import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { findRecentReceiveActivityId } from "../account/activityStore";
import { getNetworkConfig } from "../config/network";
import type { RootNav, RootStackParamList } from "../navigation/types";
import { useWallet } from "../wallet/WalletProvider";
import { FundsReceivedView } from "./FundsReceivedView";

export function FundsReceivedScreen() {
  const navigation = useNavigation<RootNav>();
  const route = useRoute<RouteProp<RootStackParamList, "FundsReceived">>();
  const { amount, kind } = route.params;
  const { selectedWallet } = useWallet();

  return (
    <FundsReceivedView
      amount={amount}
      kind={kind}
      onViewDetails={() => {
        const walletId = selectedWallet?.id;
        if (walletId) {
          const activityId = findRecentReceiveActivityId(
            getNetworkConfig().id,
            walletId,
            amount,
            kind,
          );
          if (activityId) {
            navigation.replace("ActivityDetail", { activityId, walletId });
            return;
          }
        }
        navigation.navigate("Home");
      }}
      onDone={() => navigation.navigate("Home")}
    />
  );
}
